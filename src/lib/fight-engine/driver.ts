// What a match is driven by: the local AI game, a rollback session against
// a remote peer, or the AI behind a simulated network. fight.ts renders
// `state`, feeds `tick` the local player's input once per 60 Hz step and
// stops when `outcome` turns non-zero -- it does not know which one it has.
import type { FighterConfig, LevelConfig } from '../fight.ts';
import { type AiProfile, aiInput } from './ai.ts';
import { G_OVER, type SimState } from './sim.ts';

export interface Driver {
  /** The state to render; with rollback, the predicted present. */
  readonly state: SimState;
  /** Advance one tick with the local player's IN_* bits; returns EV_* bits. */
  tick(localInput: number): number;
  /** OVER_* once the result is final for everyone involved, else 0. */
  readonly outcome: number;
  /**
   * Whether the next tick will use the input it is given. Where it will not
   * (rollback waiting for the peer), a latched button press must be kept for
   * a later tick instead of being spent on this one.
   */
  readonly wantsInput: boolean;
  /** The peers' results can no longer be trusted to agree; the match is void. */
  readonly desynced: boolean;
  /** A line for the HUD describing the connection, or null when there is none. */
  status(): string | null;
  /**
   * After the match: re-send what the peer may still be missing. Returns true
   * once nothing is owed any more. Absent where there is no peer.
   */
  flush?(): boolean;
}

/** The player is fighter 0, the handwritten AI fighter 1, nothing in between. */
export function aiDriver(
  state: SimState,
  stepFn: (input0: number, input1: number) => number,
  profile?: AiProfile,
): Driver {
  return {
    state,
    tick: (localInput) => stepFn(localInput, aiInput(state, 1, profile)),
    get outcome() {
      return state[G_OVER] as number;
    },
    wantsInput: true,
    desynced: false,
    status: () => null,
  };
}

/** Everything a match needs to exist, however it is driven. */
export interface MatchSetup {
  readonly driver: Driver;
  /** Fighter 0 starts on the left, fighter 1 on the right. */
  readonly fighters: readonly [FighterConfig, FighterConfig];
  /** Which of the two the person at this screen controls. */
  readonly local: 0 | 1;
  readonly level: LevelConfig;
  /** True when the Rust/WebAssembly step runs this match (the legend says so). */
  readonly wasm?: boolean;
}
