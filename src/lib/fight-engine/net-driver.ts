// Drivers that run the match through rollback netcode (see rollback.ts).
import { type AiProfile, aiInput } from './ai.ts';
import type { Driver } from './driver.ts';
import { createLoopback, type LoopbackOptions, RollbackSession } from './rollback.ts';
import {
  cloneState,
  copyState,
  F_AI_DIR,
  F_AI_NEXT,
  fighterBase,
  G_RNG,
  type SimState,
} from './sim.ts';

// Half a second of overdue input: long enough that it is not just jitter.
const WAITING_TICKS = 30;

function describe(session: RollbackSession): string {
  const { rollbacks, maxRollbackFrames } = session.stats;
  const parts = [
    `rollbacks ${rollbacks}`,
    `deepest ${maxRollbackFrames}f`,
    `guessing ${session.predictedFrames}f`,
  ];
  if (session.stalledFor > WAITING_TICKS) parts.push('waiting for your friend');
  if (session.desynced) parts.push('OUT OF SYNC');
  return parts.join(' · ');
}

/** A real opponent on the other end of `session`'s transport. */
export function peerDriver(session: RollbackSession): Driver {
  return {
    state: session.current,
    tick: (localInput) => session.advance(localInput),
    get outcome() {
      return session.outcome;
    },
    get wantsInput() {
      return session.wantsInput;
    },
    get desynced() {
      return session.desynced;
    },
    status: () => describe(session),
    flush: () => session.flush(),
  };
}

/**
 * The AI as a remote peer: it plays on its own rollback session, linked to
 * the player's by an in-process network with the given latency, jitter and
 * loss. Exists to see and feel rollback without a second machine.
 */
export function laggedAiDriver(
  initial: SimState,
  net: LoopbackOptions,
  profile?: AiProfile,
): Driver {
  const link = createLoopback(net);
  const player = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const remote = new RollbackSession({ local: 1, state: initial, transport: link.b });

  // The AI keeps its memory (next decision frame, walk direction, random
  // state) in the sim state it is shown. Every rollback overwrites that
  // state with the confirmed one, so here the memory lives in a scratch
  // copy that only borrows the rest of the remote peer's present.
  const ai = fighterBase(1);
  const scratch = cloneState(initial);
  let aiNext = 0;
  let aiDir = 0;
  let rng = initial[G_RNG] as number;
  const think = (): number => {
    copyState(scratch, remote.current);
    scratch[ai + F_AI_NEXT] = aiNext;
    scratch[ai + F_AI_DIR] = aiDir;
    scratch[G_RNG] = rng;
    const input = aiInput(scratch, 1, profile);
    aiNext = scratch[ai + F_AI_NEXT] as number;
    aiDir = scratch[ai + F_AI_DIR] as number;
    rng = scratch[G_RNG] as number;
    return input;
  };

  return {
    state: player.current,
    tick(localInput) {
      remote.advance(think());
      link.tick();
      return player.advance(localInput);
    },
    get outcome() {
      return player.outcome;
    },
    get wantsInput() {
      return player.wantsInput;
    },
    get desynced() {
      return player.desynced;
    },
    status: () => `${describe(player)} · simulated ${Math.round((net.delay * 1000) / 60)}ms`,
  };
}
