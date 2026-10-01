// The hand-written opponent, as an input source: it reads the sim state and
// answers with the same IN_* bitmask a keyboard or a remote player would.
// Its three words of memory (next decision frame, walk direction, the button
// it means to hold) and its randomness live in the sim state, so it replays and rolls back
// with the match.
import {
  ATTACK_RANGE,
  ATTACK_W,
  BOX_W,
  F_AI_DIR,
  F_AI_INTENT,
  F_AI_NEXT,
  F_ANIM_CFG,
  F_ANIM_FRAME,
  F_ANIM_TICK,
  F_COOLDOWN_UNTIL,
  F_DID_HIT,
  F_FACING,
  F_HIT_UNTIL,
  F_PROJ_KIND,
  F_PROJ_VX,
  F_PROJ_X,
  F_SPECIAL,
  F_SPECIAL_UNTIL,
  F_STATE,
  F_VX,
  F_X,
  FP,
  fighterBase,
  G_FRAME,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  IN_SPECIAL,
  isOnGround,
  nextRandom,
  PROJ_W,
  type SimState,
  SP_NONE,
  ST_ATTACK1,
  ST_ATTACK2,
  ST_DEATH,
  ST_TAKE_HIT,
} from './sim.ts';

// Close enough to stop walking in...
const CLOSE_ENOUGH = (ATTACK_RANGE + 10) * FP;
// ...and near enough for a swing to connect, with a little to spare: a swing
// reaches ATTACK_W beyond the front of the box.
const REACH = (BOX_W + ATTACK_W - 12) * FP;
/** Percent chance per decision, at a distance, to jump for no reason. */
const IDLE_JUMP_CHANCE = 8;
// How many frames before a projectile arrives the jump over it has to
// start, indexed by SP_*: late enough to still be up when it has passed,
// early enough to be high enough when it gets there.
const DODGE_LEAD: readonly number[] = [0, 9, 10, 0, 3];
/** For how many frames an opponent who could swing counts as "about to". */
const JUST_READY_FRAMES = 2;

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
  /** Percent chance that a decision made at a distance is the special move. */
  readonly specialChance: number;
  /** Percent chance to jump over a projectile that is about to arrive. */
  readonly dodgeChance: number;
  /** Walking speed as a fraction of the player's. */
  readonly speed: number;
  /** Damage dealt, in percent of the player's (the sim's F_POWER). */
  readonly power: number;
  /**
   * Never throws a swing away: it does not start one that the opponent's
   * swing would cut short, and answers right after the blow instead.
   */
  readonly careful: boolean;
  /**
   * Decides on every frame instead of at intervals, wastes no jumps, and
   * answers an opponent in the air with the heavy swing.
   */
  readonly relentless: boolean;
}

// Measured against a player who just stands there (median of 200 matches,
// the walk across the arena included): easy needs 30 seconds, normal 15,
// hard 8 and unwinnable 2. Unwinnable is not a fair fight and is not meant
// to be: it reads the state on every frame, never throws a swing away, walks
// faster than the player and hits three times as hard, so even a trade of
// blows is a loss. tests/fight-ai.test.ts plays a set of scripted strategies
// against it; none of them wins a single match.
export const AI_PROFILES = {
  easy: {
    decisionMin: 45,
    decisionSpread: 45,
    attackChance: 35,
    heavyChance: 15,
    specialChance: 10,
    dodgeChance: 0,
    speed: 0.7,
    power: 100,
    careful: false,
    relentless: false,
  },
  normal: {
    decisionMin: 30,
    decisionSpread: 30,
    attackChance: 45,
    heavyChance: 25,
    specialChance: 25,
    dodgeChance: 40,
    speed: 0.8,
    power: 100,
    careful: false,
    relentless: false,
  },
  hard: {
    decisionMin: 21,
    decisionSpread: 24,
    attackChance: 55,
    heavyChance: 35,
    specialChance: 40,
    dodgeChance: 75,
    speed: 0.85,
    power: 100,
    careful: true,
    relentless: false,
  },
  unwinnable: {
    decisionMin: 0,
    decisionSpread: 0,
    attackChance: 100,
    heavyChance: 0,
    specialChance: 100,
    dodgeChance: 100,
    speed: 1.15,
    power: 300,
    careful: true,
    relentless: true,
  },
} as const satisfies Record<string, AiProfile>;

export type Difficulty = keyof typeof AI_PROFILES;

export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === 'string' && Object.hasOwn(AI_PROFILES, value);

/** Can `me` start its special move on this frame? */
function specialReady(s: SimState, me: number, frame: number): boolean {
  return (
    s[me + F_SPECIAL] !== SP_NONE &&
    s[me + F_PROJ_KIND] === SP_NONE &&
    frame >= (s[me + F_SPECIAL_UNTIL] as number) &&
    frame >= (s[me + F_COOLDOWN_UNTIL] as number)
  );
}

/**
 * IN_JUMP on the one frame a jump over the opponent's projectile has to
 * start (and the dice agree), else 0.
 */
function dodge(s: SimState, me: number, opp: number, profile: AiProfile): number {
  const kind = s[opp + F_PROJ_KIND] as number;
  if (kind === SP_NONE || profile.dodgeChance === 0 || !isOnGround(s, me)) return 0;
  const vx = s[opp + F_PROJ_VX] as number;
  const px = s[opp + F_PROJ_X] as number;
  const x = s[me + F_X] as number;
  // Distance its leading edge still has to travel to reach this fighter's box.
  const gap = vx > 0 ? x - (px + (PROJ_W[kind] as number) * FP) : px - (x + BOX_W * FP);
  if (gap < 0) return 0;
  // Walking into it brings it closer faster.
  const mine = s[me + F_VX] as number;
  const closing = Math.abs(vx) + (vx > 0 ? -mine : mine);
  if (closing <= 0) return 0;
  const lead = DODGE_LEAD[kind] as number;
  if (gap > lead * closing || gap <= (lead - 1) * closing) return 0;
  return nextRandom(s) % 100 < profile.dodgeChance ? IN_JUMP : 0;
}

/** The first swing frame on which the blade is out (see landedDamage in sim.ts). */
const firstLiveFrame = (frames: number): number => Math.floor((frames * 3) / 10);

/**
 * How many steps from now the swing `b` is in can first connect: 1 when it
 * can on the very next step, 0 when it cannot any more (it already hit, or
 * its window is over, or there is no swing).
 */
function swingLandsIn(s: SimState, b: number): number {
  const st = s[b + F_STATE] as number;
  if ((st !== ST_ATTACK1 && st !== ST_ATTACK2) || s[b + F_DID_HIT] !== 0) return 0;
  const frames = s[b + F_ANIM_CFG + st * 2] as number;
  const hold = s[b + F_ANIM_CFG + st * 2 + 1] as number;
  const at = s[b + F_ANIM_FRAME] as number;
  if (at > Math.ceil((frames * 8) / 10)) return 0;
  const first = firstLiveFrame(frames);
  if (at >= first) return 1;
  return (first - at) * hold - (s[b + F_ANIM_TICK] as number);
}

/** Steps from starting the swing `st` until it can connect: it is one tick old after the first. */
const startup = (s: SimState, b: number, st: number): number =>
  Math.max(
    1,
    firstLiveFrame(s[b + F_ANIM_CFG + st * 2] as number) *
      (s[b + F_ANIM_CFG + st * 2 + 1] as number),
  );

/**
 * Would a swing started now be cut short? The opponent's swing is already
 * on its way, this fighter is where it lands, and it lands first: the hit
 * cancels the swing, and the cooldown is spent for nothing. A same-step
 * trade does not count; whether that is worth it is the caller's call.
 */
function swingIsDoomed(s: SimState, me: number, opp: number, dx: number, light: boolean): boolean {
  // Their blade only reaches what is in front of them.
  const facingMe = (s[opp + F_FACING] as number) === (dx < 0 ? 1 : -1);
  if (!facingMe || Math.abs(dx) >= (BOX_W + ATTACK_W) * FP) return false;
  const mine = startup(s, me, light ? ST_ATTACK1 : ST_ATTACK2);
  const theirs = swingLandsIn(s, opp);
  if (theirs !== 0) return theirs < mine;

  // Not swinging yet -- but a quicker opponent who has only just become able
  // to (cooldown or stun over within the last frames) may well start on this
  // very step, and would land first. One who has been able to for a while
  // and has not is not mashing the button; then waiting gains nothing.
  const st = s[opp + F_STATE] as number;
  if (st === ST_DEATH) return false;
  if (Math.min(startup(s, opp, ST_ATTACK1), startup(s, opp, ST_ATTACK2)) >= mine) return false;
  const frame = s[G_FRAME] as number;
  let able = s[opp + F_COOLDOWN_UNTIL] as number;
  if (st === ST_TAKE_HIT) able = Math.max(able, (s[opp + F_HIT_UNTIL] as number) + 1);
  return able <= frame && able >= frame - JUST_READY_FRAMES;
}

export function aiInput(s: SimState, index: 0 | 1, profile: AiProfile = AI_PROFILES.hard): number {
  const me = fighterBase(index);
  const opp = fighterBase(index === 0 ? 1 : 0);
  const st = s[me + F_STATE];
  if (st === ST_DEATH || st === ST_TAKE_HIT) return 0;

  const dx = (s[opp + F_X] as number) - (s[me + F_X] as number);
  const toward = dx < 0 ? -1 : 1;
  const close = Math.abs(dx) < CLOSE_ENOUGH;
  const inReach = Math.abs(dx) < REACH;
  const frame = s[G_FRAME] as number;
  let input = dodge(s, me, opp, profile);

  if (frame >= (s[me + F_AI_NEXT] as number)) {
    s[me + F_AI_NEXT] =
      frame + profile.decisionMin + (nextRandom(s) % (profile.decisionSpread + 1));
    s[me + F_AI_INTENT] = 0;
    if (inReach) {
      // Keeps closing in while it swings, until it stands where it wants to be.
      s[me + F_AI_DIR] = close ? 0 : toward;
      if (nextRandom(s) % 100 < profile.attackChance) {
        const heavy = profile.relentless
          ? !isOnGround(s, opp)
          : nextRandom(s) % 100 < profile.heavyChance;
        const button = heavy ? IN_ATTACK2 : IN_ATTACK1;
        // The careful ones keep the button in mind until the next decision
        // (below); the others press it once, now.
        if (profile.careful) s[me + F_AI_INTENT] = button;
        else input |= button;
      }
    } else {
      s[me + F_AI_DIR] = toward;
      if (specialReady(s, me, frame) && nextRandom(s) % 100 < profile.specialChance) {
        // Walking toward the opponent turns the fighter that way, which is
        // where the move goes when it fires a few frames later.
        input |= IN_SPECIAL;
      } else if (
        !profile.relentless &&
        isOnGround(s, me) &&
        nextRandom(s) % 100 < IDLE_JUMP_CHANCE
      ) {
        input |= IN_JUMP;
      }
    }
  }

  // Holding the button like a player would: the swing comes as soon as the
  // cooldown allows and repeats -- except where it would be thrown away.
  const intent = s[me + F_AI_INTENT] as number;
  if (intent !== 0 && inReach && !swingIsDoomed(s, me, opp, dx, intent === IN_ATTACK1)) {
    input |= intent;
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
