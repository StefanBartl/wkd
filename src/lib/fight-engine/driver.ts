// What a match is driven by: the local AI game, a rollback session against
// a remote peer, or the AI behind a simulated network. fight.ts renders
// `state`, feeds `tick` the local player's input once per 60 Hz step and
// stops when `outcome` turns non-zero -- it does not know which one it has.
import type { FighterConfig, LevelConfig } from '../fight.ts';
import { aiInput } from './ai.ts';
import { G_OVER, type SimState } from './sim.ts';

export interface Driver {
  /** The state to render; with rollback, the predicted present. */
  readonly state: SimState;
  /** Advance one tick with the local player's IN_* bits; returns EV_* bits. */
  tick(localInput: number): number;
  /** OVER_* once the result is final for everyone involved, else 0. */
  readonly outcome: number;
  /** A line for the HUD describing the connection, or null when there is none. */
  status(): string | null;
}

/** The player is fighter 0, the handwritten AI fighter 1, nothing in between. */
export function aiDriver(
  state: SimState,
  stepFn: (input0: number, input1: number) => number,
): Driver {
  return {
    state,
    tick: (localInput) => stepFn(localInput, aiInput(state, 1)),
    get outcome() {
      return state[G_OVER] as number;
    },
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
}
