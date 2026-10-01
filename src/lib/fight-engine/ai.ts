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
const DECISION_MIN_FRAMES = 21; // 350ms
const DECISION_SPREAD_FRAMES = 24; // up to +400ms

export function aiInput(s: SimState, index: 0 | 1): number {
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
      frame + DECISION_MIN_FRAMES + (nextRandom(s) % (DECISION_SPREAD_FRAMES + 1));
    if (close) {
      s[me + F_AI_DIR] = 0;
      if (nextRandom(s) % 100 < 55) input |= nextRandom(s) % 100 < 35 ? IN_ATTACK2 : IN_ATTACK1;
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
