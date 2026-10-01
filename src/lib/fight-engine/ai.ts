// The hand-written opponent, as an input source: it reads the sim state and
// answers with the same IN_* bitmask a keyboard or a remote player would.
// Its two words of memory (next decision frame, current walk direction)
// and its randomness live in the sim state, so it replays and rolls back
// with the match.
import {
  ATTACK_RANGE,
  F_AI_DIR,
  F_AI_NEXT,
  F_FACING,
  F_STATE,
  F_X,
  FP,
  fighterBase,
  G_FRAME,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  isOnGround,
  nextRandom,
  type SimState,
  ST_DEATH,
  ST_TAKE_HIT,
} from './sim.ts';

const CLOSE_ENOUGH = (ATTACK_RANGE + 10) * FP;

/** How the opponent plays; the numbers are all it takes to make it easier or harder. */
export interface AiProfile {
  /** Frames between two decisions: at least this many... */
  readonly decisionMin: number;
  /** ...plus up to this many more, picked at random. */
  readonly decisionSpread: number;
  /** Percent chance that a decision made in range is an attack. */
  readonly attackChance: number;
  /** Percent chance that such an attack is the heavy one. */
  readonly heavyChance: number;
  /** Walking speed as a fraction of the player's. */
  readonly speed: number;
}

// Measured against a player who just stands there (median of 200 matches,
// the walk across the arena included): hard wins in 11 seconds, normal in
// 16, easy takes 31. Hard is what the opponent was before there was a choice.
export const AI_PROFILES = {
  easy: { decisionMin: 45, decisionSpread: 45, attackChance: 35, heavyChance: 15, speed: 0.7 },
  normal: { decisionMin: 30, decisionSpread: 30, attackChance: 45, heavyChance: 25, speed: 0.8 },
  hard: { decisionMin: 21, decisionSpread: 24, attackChance: 55, heavyChance: 35, speed: 0.85 },
} as const satisfies Record<string, AiProfile>;

export type Difficulty = keyof typeof AI_PROFILES;

export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === 'string' && Object.hasOwn(AI_PROFILES, value);

export function aiInput(s: SimState, index: 0 | 1, profile: AiProfile = AI_PROFILES.hard): number {
  const me = fighterBase(index);
  const opp = fighterBase(index === 0 ? 1 : 0);
  const st = s[me + F_STATE];
  if (st === ST_DEATH || st === ST_TAKE_HIT) return 0;

  const dx = (s[opp + F_X] as number) - (s[me + F_X] as number);
  const toward = dx < 0 ? -1 : 1;
  const close = Math.abs(dx) < CLOSE_ENOUGH;
  const frame = s[G_FRAME] as number;
  let input = 0;

  if (frame >= (s[me + F_AI_NEXT] as number)) {
    s[me + F_AI_NEXT] =
      frame + profile.decisionMin + (nextRandom(s) % (profile.decisionSpread + 1));
    if (close) {
      s[me + F_AI_DIR] = 0;
      if (nextRandom(s) % 100 < profile.attackChance) {
        input |= nextRandom(s) % 100 < profile.heavyChance ? IN_ATTACK2 : IN_ATTACK1;
      }
    } else {
      s[me + F_AI_DIR] = toward;
      if (isOnGround(s, me) && nextRandom(s) % 100 < 8) input |= IN_JUMP;
    }
  }

  if (!close) {
    const dir = s[me + F_AI_DIR] as number;
    if (dir < 0) input |= IN_LEFT;
    else if (dir > 0) input |= IN_RIGHT;
  } else if (s[me + F_FACING] !== toward) {
    // In range but looking the wrong way (the opponent jumped over): one
    // step toward them turns the fighter around, and with it the attack box.
    input |= toward < 0 ? IN_LEFT : IN_RIGHT;
  }
  return input;
}
