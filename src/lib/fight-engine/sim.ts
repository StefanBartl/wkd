// Deterministic simulation core of the fight minigame: plain integers in,
// plain integers out. No DOM, no wall clock, no Math.random, no floats --
// the whole match lives in one Int32Array so it can be copied (rollback),
// hashed (desync checks), sent over the wire and handed to a WASM build of
// this same file's step() without translation. Rendering, audio and input
// collection live in src/scripts/fight.ts and only read this state.
//
// Relative imports carry their .ts extension and the file sticks to erasable
// TypeScript so plain `node --test` can run it.
import {
  type AnimKey,
  CANVAS,
  type FighterConfig,
  GROUND_Y,
  MATCH_SECONDS,
  SPECIAL,
} from '../fight.ts';

/** Fixed-point scale for positions and velocities: 1 px = 256 units. */
export const FP = 256;
export const SIM_HZ = 60;

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_ATTACK1 = 8;
export const IN_ATTACK2 = 16;
export const IN_SPECIAL = 32;

export const ST_IDLE = 0;
export const ST_RUN = 1;
export const ST_JUMP = 2;
export const ST_FALL = 3;
export const ST_ATTACK1 = 4;
export const ST_ATTACK2 = 5;
export const ST_TAKE_HIT = 6;
export const ST_DEATH = 7;
export const ST_SPECIAL = 8;

/**
 * Index = ST_* value; the renderer maps a state to its sprite sheet with
 * this. The sprite packs have no animation of their own for a special move,
 * so it borrows the heavy swing.
 */
export const STATE_ANIM: readonly AnimKey[] = [
  'idle',
  'run',
  'jump',
  'fall',
  'attack1',
  'attack2',
  'takeHit',
  'death',
  'attack2',
];

// Events are a bitmask rather than objects so step() stays allocation-free
// and has the same signature in WASM. Everything a listener needs beyond
// "it happened" (where, who) is readable from the state afterwards.
export const EV_HIT_P0 = 1; // fighter 0 was hit
export const EV_HIT_P1 = 2;
export const EV_LAND_P0 = 4;
export const EV_LAND_P1 = 8;
export const EV_KO = 16;
export const EV_TIMEUP = 32;
export const EV_FIGHT = 64; // intro over, controls live
export const EV_SPECIAL = 128; // a special move went off (either fighter)

export const OVER_NONE = 0;
export const OVER_P0 = 1;
export const OVER_P1 = 2;
export const OVER_DRAW = 3;

// Special moves; the numbers come from fight.ts, where the fighters name theirs.
export const SP_NONE = SPECIAL.none;
export const SP_BULLET = SPECIAL.bullet;
export const SP_ORB = SPECIAL.orb;
export const SP_TELEPORT = SPECIAL.teleport;
export const SP_WAVE = SPECIAL.wave;

// ---- state layout -------------------------------------------------------
export const G_FRAME = 0;
export const G_RNG = 1;
export const G_OVER = 2;
const GLOBAL_SIZE = 8;

export const F_X = 0;
export const F_Y = 1;
export const F_VX = 2;
export const F_VY = 3;
export const F_FACING = 4;
export const F_HEALTH = 5;
export const F_STATE = 6;
export const F_ANIM_FRAME = 7;
export const F_ANIM_TICK = 8;
export const F_COOLDOWN_UNTIL = 9;
export const F_HIT_UNTIL = 10;
export const F_DID_HIT = 11;
export const F_SPEED = 12;
export const F_AI_NEXT = 13;
export const F_AI_DIR = 14;
/** Damage this fighter deals, in percent of the base values. Constant per match. */
export const F_POWER = 15;
/** 9 x (frames, hold), indexed by ST_*: per-fighter config, constant per match. */
export const F_ANIM_CFG = 16;
/** Which special move this fighter has (SP_*). Constant per match. */
export const F_SPECIAL = 34;
export const F_SPECIAL_UNTIL = 35;
// The one projectile a fighter can have in flight: its kind (SP_NONE for
// none), the top-left corner of its box, its speed and the frame it expires.
export const F_PROJ_KIND = 36;
export const F_PROJ_X = 37;
export const F_PROJ_Y = 38;
export const F_PROJ_VX = 39;
export const F_PROJ_UNTIL = 40;
export const FIGHTER_SIZE = 48;

export const STATE_LEN = GLOBAL_SIZE + 2 * FIGHTER_SIZE;
export type SimState = Int32Array;

export const fighterBase = (index: 0 | 1): number => GLOBAL_SIZE + index * FIGHTER_SIZE;

// ---- tuning (all in px or frames, converted once) -----------------------
export const ARENA_W = CANVAS.w;
export const BOX_W = 90;
export const BOX_H = 150;
/**
 * In the air a fighter draws its legs up: the hurt box ends this much
 * higher. With the light attack reaching low and the heavy one high, a jump
 * timed ahead of a light swing clears it, while the heavy swing stays the
 * answer to a jumping opponent.
 */
export const AIR_TUCK = 30;
export const ATTACK_RANGE = 90;
const ATTACK_W = 100;
const ATTACK_H = 60;
/** Top of the attack box below the top of the attacker's own box. */
const ATTACK1_Y_OFFSET = 50;
const ATTACK2_Y_OFFSET = 10;
export const EDGE_MARGIN = 10;

export const MOVE_SPEED = Math.round(4.2 * FP);
const GRAVITY = Math.round(0.55 * FP);
const JUMP_VELOCITY = Math.round(-12.5 * FP);

export const INTRO_FRAMES = 54; // 900ms
export const MATCH_FRAMES = MATCH_SECONDS * SIM_HZ;
const HIT_STUN_FRAMES = 21; // 350ms
const ATTACK1_DAMAGE = 10;
const ATTACK1_COOLDOWN = 27; // 450ms
const ATTACK2_DAMAGE = 22;
const ATTACK2_COOLDOWN = 57; // 950ms

/** No swing for this long after starting a special move. */
const SPECIAL_RECOVERY = 36;
/** How far behind the opponent a teleport lands, box edge to box edge. */
const TELEPORT_GAP = 20;

/** Per special move, indexed by SP_*: frames until it can be used again. */
export const SPECIAL_COOLDOWN: readonly number[] = [0, 150, 270, 180, 210];
// Projectiles, indexed by SP_* (the teleport has none): size, speed per
// frame, base damage, lifetime, and where the box starts below the top of
// the fighter's box. The wave has no such offset, it runs along the ground.
export const PROJ_W: readonly number[] = [0, 16, 36, 0, 40];
export const PROJ_H: readonly number[] = [0, 8, 36, 0, 36];
const PROJ_SPEED: readonly number[] = [0, 14 * FP, 5 * FP, 0, 7 * FP];
const PROJ_DAMAGE: readonly number[] = [0, 8, 18, 0, 14];
const PROJ_LIFE: readonly number[] = [0, 90, 240, 0, 150];
const PROJ_Y_OFFSET: readonly number[] = [0, 55, 40, 0, 0];

const GROUND_FP = GROUND_Y * FP;
const BOX_W_FP = BOX_W * FP;
const BOX_H_FP = BOX_H * FP;
const MIN_X_FP = EDGE_MARGIN * FP;
const MAX_X_FP = (ARENA_W - BOX_W - EDGE_MARGIN) * FP;

export interface FighterSetup {
  readonly anim: FighterConfig['anim'];
  /** Horizontal speed in FP units per frame; defaults to MOVE_SPEED. */
  readonly speed?: number;
  /** The special move (SP_*); none when left out. */
  readonly special?: number;
  /** Damage dealt, in percent; 100 when left out. */
  readonly power?: number;
}

export function createState(p0: FighterSetup, p1: FighterSetup, seed: number): SimState {
  const s = new Int32Array(STATE_LEN);
  s[G_RNG] = seed | 0;
  initFighter(s, fighterBase(0), 180 * FP, 1, p0);
  initFighter(s, fighterBase(1), (ARENA_W - 180 - BOX_W) * FP, -1, p1);
  return s;
}

function initFighter(s: SimState, b: number, x: number, facing: number, cfg: FighterSetup): void {
  s[b + F_X] = x;
  s[b + F_Y] = GROUND_FP - BOX_H_FP;
  s[b + F_FACING] = facing;
  s[b + F_HEALTH] = 100;
  s[b + F_SPEED] = cfg.speed ?? MOVE_SPEED;
  s[b + F_POWER] = cfg.power ?? 100;
  // The tables below are indexed by this; anything else is "no special move".
  const special = cfg.special ?? SP_NONE;
  s[b + F_SPECIAL] = special > 0 && special < SPECIAL_COOLDOWN.length ? special : SP_NONE;
  for (let st = 0; st < STATE_ANIM.length; st++) {
    const key = STATE_ANIM[st] as AnimKey;
    s[b + F_ANIM_CFG + st * 2] = cfg.anim[key].frames;
    s[b + F_ANIM_CFG + st * 2 + 1] = cfg.anim[key].hold;
  }
}

export const cloneState = (s: SimState): SimState => s.slice();
export const copyState = (dst: SimState, src: SimState): void => dst.set(src);

/** FNV-1a over every word of the state. */
export function hashState(s: SimState): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i] as number;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 24), 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32, state kept in the sim so AI randomness rolls back with it. */
export function nextRandom(s: SimState): number {
  const a = ((s[G_RNG] as number) + 0x6d2b79f5) | 0;
  s[G_RNG] = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

export const isOnGround = (s: SimState, b: number): boolean =>
  (s[b + F_Y] as number) + BOX_H_FP >= GROUND_FP;

/** Where the fighter's hurt box ends: at its feet, or higher while it is in the air. */
export const hurtBottom = (s: SimState, b: number): number =>
  (s[b + F_Y] as number) + BOX_H_FP - (isOnGround(s, b) ? 0 : AIR_TUCK * FP);

const isAttack = (st: number): boolean => st === ST_ATTACK1 || st === ST_ATTACK2;
/** A swing or a special move: plays to its end before anything but a hit interrupts it. */
const isBusy = (st: number): boolean => isAttack(st) || st === ST_SPECIAL;
const animFrames = (s: SimState, b: number, st: number): number =>
  s[b + F_ANIM_CFG + st * 2] as number;
const animHold = (s: SimState, b: number, st: number): number =>
  s[b + F_ANIM_CFG + st * 2 + 1] as number;

function enterState(s: SimState, b: number, st: number): void {
  s[b + F_STATE] = st;
  s[b + F_ANIM_FRAME] = 0;
  s[b + F_ANIM_TICK] = 0;
}

function setState(s: SimState, b: number, next: number): void {
  const cur = s[b + F_STATE] as number;
  if (cur === next || cur === ST_DEATH) return;
  if (cur === ST_TAKE_HIT && (s[G_FRAME] as number) < (s[b + F_HIT_UNTIL] as number)) return;
  // Let a swing finish its frames before anything but a hit interrupts it.
  if (isBusy(cur) && (s[b + F_ANIM_FRAME] as number) < animFrames(s, b, cur) - 1) return;
  enterState(s, b, next);
}

function startAttack(s: SimState, b: number, kind: number): void {
  const cur = s[b + F_STATE] as number;
  if (cur === ST_DEATH || cur === ST_TAKE_HIT) return;
  const frame = s[G_FRAME] as number;
  if (frame < (s[b + F_COOLDOWN_UNTIL] as number)) return;
  enterState(s, b, kind);
  s[b + F_DID_HIT] = 0;
  s[b + F_COOLDOWN_UNTIL] = frame + (kind === ST_ATTACK1 ? ATTACK1_COOLDOWN : ATTACK2_COOLDOWN);
}

/** Returns whether the move started; when it did not, the same input may still swing. */
function startSpecial(s: SimState, b: number): boolean {
  const kind = s[b + F_SPECIAL] as number;
  if (kind === SP_NONE) return false;
  const cur = s[b + F_STATE] as number;
  if (cur === ST_DEATH || cur === ST_TAKE_HIT) return false;
  const frame = s[G_FRAME] as number;
  if (frame < (s[b + F_SPECIAL_UNTIL] as number)) return false;
  if (frame < (s[b + F_COOLDOWN_UNTIL] as number)) return false;
  // One projectile per fighter: the last one has to be gone first.
  if (s[b + F_PROJ_KIND] !== SP_NONE) return false;
  enterState(s, b, ST_SPECIAL);
  s[b + F_DID_HIT] = 0;
  s[b + F_SPECIAL_UNTIL] = frame + (SPECIAL_COOLDOWN[kind] as number);
  s[b + F_COOLDOWN_UNTIL] = frame + SPECIAL_RECOVERY;
  return true;
}

function applyInput(s: SimState, b: number, input: number): void {
  if (s[b + F_STATE] === ST_DEATH) {
    s[b + F_VX] = 0;
    return;
  }
  const speed = s[b + F_SPEED] as number;
  const vx = (input & IN_RIGHT ? speed : 0) - (input & IN_LEFT ? speed : 0);
  s[b + F_VX] = vx;
  if (vx > 0) s[b + F_FACING] = 1;
  else if (vx < 0) s[b + F_FACING] = -1;
  if (input & IN_JUMP && isOnGround(s, b)) s[b + F_VY] = JUMP_VELOCITY;
  if (input & IN_SPECIAL && startSpecial(s, b)) return;
  if (input & IN_ATTACK1) startAttack(s, b, ST_ATTACK1);
  else if (input & IN_ATTACK2) startAttack(s, b, ST_ATTACK2);
}

/** Returns true when the fighter touched down this frame. */
function physics(s: SimState, b: number): boolean {
  if (s[b + F_STATE] === ST_DEATH) return false;
  const wasAirborne = !isOnGround(s, b);
  let x = (s[b + F_X] as number) + (s[b + F_VX] as number);
  let vy = (s[b + F_VY] as number) + GRAVITY;
  let y = (s[b + F_Y] as number) + vy;
  if (y + BOX_H_FP >= GROUND_FP) {
    y = GROUND_FP - BOX_H_FP;
    vy = 0;
  }
  if (x < MIN_X_FP) x = MIN_X_FP;
  else if (x > MAX_X_FP) x = MAX_X_FP;
  s[b + F_X] = x;
  s[b + F_Y] = y;
  s[b + F_VY] = vy;

  const st = s[b + F_STATE] as number;
  const swingDone = isBusy(st) && (s[b + F_ANIM_FRAME] as number) >= animFrames(s, b, st) - 1;
  if (!isBusy(st) || swingDone) {
    if (y + BOX_H_FP < GROUND_FP) setState(s, b, vy < 0 ? ST_JUMP : ST_FALL);
    else if (s[b + F_VX] !== 0) setState(s, b, ST_RUN);
    else setState(s, b, ST_IDLE);
  }
  return wasAirborne && y + BOX_H_FP >= GROUND_FP;
}

function advanceAnim(s: SimState, b: number): void {
  const st = s[b + F_STATE] as number;
  const tick = (s[b + F_ANIM_TICK] as number) + 1;
  if (tick < animHold(s, b, st)) {
    s[b + F_ANIM_TICK] = tick;
    return;
  }
  s[b + F_ANIM_TICK] = 0;
  const frame = s[b + F_ANIM_FRAME] as number;
  if (frame < animFrames(s, b, st) - 1) s[b + F_ANIM_FRAME] = frame + 1;
  else if (st !== ST_DEATH) s[b + F_ANIM_FRAME] = 0; // death holds its last frame
}

/** Base damage scaled by the attacker's power. */
const scaled = (s: SimState, atk: number, base: number): number =>
  Math.trunc((base * (s[atk + F_POWER] as number)) / 100);

/** Does the box (x0, y0, w, h) touch the defender's hurt box? */
function touches(s: SimState, def: number, x0: number, y0: number, w: number, h: number): boolean {
  const dx0 = s[def + F_X] as number;
  const dy0 = s[def + F_Y] as number;
  return x0 < dx0 + BOX_W_FP && x0 + w > dx0 && y0 < hurtBottom(s, def) && y0 + h > dy0;
}

/** Damage the attacker's swing lands on the defender this frame, 0 for none. */
function landedDamage(s: SimState, atk: number, def: number): number {
  const st = s[atk + F_STATE] as number;
  if (!isAttack(st) || s[atk + F_DID_HIT] !== 0 || s[def + F_STATE] === ST_DEATH) return 0;
  const frames = animFrames(s, atk, st);
  const frame = s[atk + F_ANIM_FRAME] as number;
  // The middle of the swing is where the blade is actually out.
  if (frame < Math.floor((frames * 3) / 10) || frame > Math.ceil((frames * 8) / 10)) return 0;
  const ax0 =
    s[atk + F_FACING] === 1
      ? (s[atk + F_X] as number) + BOX_W_FP
      : (s[atk + F_X] as number) - ATTACK_W * FP;
  const light = st === ST_ATTACK1;
  const ay0 = (s[atk + F_Y] as number) + (light ? ATTACK1_Y_OFFSET : ATTACK2_Y_OFFSET) * FP;
  if (!touches(s, def, ax0, ay0, ATTACK_W * FP, ATTACK_H * FP)) return 0;
  return scaled(s, atk, light ? ATTACK1_DAMAGE : ATTACK2_DAMAGE);
}

/** Damage the attacker's projectile lands on the defender this frame, 0 for none. */
function projectileDamage(s: SimState, atk: number, def: number): number {
  const kind = s[atk + F_PROJ_KIND] as number;
  if (kind === SP_NONE || s[def + F_STATE] === ST_DEATH) return 0;
  const hit = touches(
    s,
    def,
    s[atk + F_PROJ_X] as number,
    s[atk + F_PROJ_Y] as number,
    (PROJ_W[kind] as number) * FP,
    (PROJ_H[kind] as number) * FP,
  );
  return hit ? scaled(s, atk, PROJ_DAMAGE[kind] as number) : 0;
}

function hurt(s: SimState, def: number, damage: number): void {
  const health = Math.max(0, (s[def + F_HEALTH] as number) - damage);
  s[def + F_HEALTH] = health;
  s[def + F_HIT_UNTIL] = (s[G_FRAME] as number) + HIT_STUN_FRAMES;
  enterState(s, def, health <= 0 ? ST_DEATH : ST_TAKE_HIT);
}

/** Moves the fighter's projectile, and retires it at the end of its life or of the arena. */
function moveProjectile(s: SimState, b: number): void {
  const kind = s[b + F_PROJ_KIND] as number;
  if (kind === SP_NONE) return;
  const x = (s[b + F_PROJ_X] as number) + (s[b + F_PROJ_VX] as number);
  s[b + F_PROJ_X] = x;
  const gone =
    (s[G_FRAME] as number) >= (s[b + F_PROJ_UNTIL] as number) ||
    x + (PROJ_W[kind] as number) * FP < 0 ||
    x > ARENA_W * FP;
  if (gone) s[b + F_PROJ_KIND] = SP_NONE;
}

/**
 * Halfway through the special animation the move goes off: a projectile
 * leaves, or the fighter is gone and behind the opponent. A hit before that
 * moment cancels it (the cooldown is spent all the same). Returns whether it
 * went off this frame.
 */
function fireSpecial(s: SimState, b: number, opp: number): boolean {
  if (s[b + F_STATE] !== ST_SPECIAL || s[b + F_DID_HIT] !== 0) return false;
  const half = animFrames(s, b, ST_SPECIAL) >> 1;
  if ((s[b + F_ANIM_FRAME] as number) < half) return false;
  s[b + F_DID_HIT] = 1;
  const kind = s[b + F_SPECIAL] as number;
  const x = s[b + F_X] as number;
  if (kind === SP_TELEPORT) {
    const ox = s[opp + F_X] as number;
    const behind = x <= ox ? ox + (BOX_W + TELEPORT_GAP) * FP : ox - (BOX_W + TELEPORT_GAP) * FP;
    const target = behind < MIN_X_FP ? MIN_X_FP : behind > MAX_X_FP ? MAX_X_FP : behind;
    s[b + F_X] = target;
    s[b + F_FACING] = target > ox ? -1 : 1;
    return true;
  }
  const facing = s[b + F_FACING] as number;
  s[b + F_PROJ_KIND] = kind;
  s[b + F_PROJ_X] = facing === 1 ? x + BOX_W_FP : x - (PROJ_W[kind] as number) * FP;
  s[b + F_PROJ_Y] =
    kind === SP_WAVE
      ? GROUND_FP - (PROJ_H[kind] as number) * FP
      : (s[b + F_Y] as number) + (PROJ_Y_OFFSET[kind] as number) * FP;
  s[b + F_PROJ_VX] = facing * (PROJ_SPEED[kind] as number);
  s[b + F_PROJ_UNTIL] = (s[G_FRAME] as number) + (PROJ_LIFE[kind] as number);
  return true;
}

/** Whole seconds left on the match clock, for the HUD. */
export function secondsLeft(s: SimState): number {
  const left = INTRO_FRAMES + MATCH_FRAMES - (s[G_FRAME] as number);
  return Math.max(0, Math.min(MATCH_FRAMES / SIM_HZ, Math.ceil(left / SIM_HZ)));
}

/**
 * Advance the match by exactly one 60 Hz frame. Inputs are IN_* bitmasks
 * and level-triggered: a held attack re-fires as soon as its cooldown
 * allows, a held jump re-jumps on landing. Returns an EV_* bitmask.
 */
export function step(s: SimState, input0: number, input1: number): number {
  if (s[G_OVER] !== OVER_NONE) return 0;
  const p0 = fighterBase(0);
  const p1 = fighterBase(1);
  const frame = s[G_FRAME] as number;

  if (frame < INTRO_FRAMES) {
    advanceAnim(s, p0);
    advanceAnim(s, p1);
    s[G_FRAME] = frame + 1;
    return frame + 1 === INTRO_FRAMES ? EV_FIGHT : 0;
  }

  let events = 0;
  applyInput(s, p0, input0);
  applyInput(s, p1, input1);
  if (physics(s, p0)) events |= EV_LAND_P0;
  if (physics(s, p1)) events |= EV_LAND_P1;
  advanceAnim(s, p0);
  advanceAnim(s, p1);
  moveProjectile(s, p0);
  moveProjectile(s, p1);
  if (fireSpecial(s, p0, p1)) events |= EV_SPECIAL;
  if (fireSpecial(s, p1, p0)) events |= EV_SPECIAL;

  // Everything is judged against the pre-hit state and only then applied,
  // so a same-frame trade hurts both sides instead of favouring fighter 0.
  const swingTo1 = landedDamage(s, p0, p1);
  const swingTo0 = landedDamage(s, p1, p0);
  const shotTo1 = projectileDamage(s, p0, p1);
  const shotTo0 = projectileDamage(s, p1, p0);
  if (swingTo1 > 0) s[p0 + F_DID_HIT] = 1;
  if (swingTo0 > 0) s[p1 + F_DID_HIT] = 1;
  if (shotTo1 > 0) s[p0 + F_PROJ_KIND] = SP_NONE;
  if (shotTo0 > 0) s[p1 + F_PROJ_KIND] = SP_NONE;
  if (swingTo1 + shotTo1 > 0) {
    hurt(s, p1, swingTo1 + shotTo1);
    events |= EV_HIT_P1;
  }
  if (swingTo0 + shotTo0 > 0) {
    hurt(s, p0, swingTo0 + shotTo0);
    events |= EV_HIT_P0;
  }

  s[G_FRAME] = frame + 1;

  const dead0 = s[p0 + F_STATE] === ST_DEATH;
  const dead1 = s[p1 + F_STATE] === ST_DEATH;
  const timeUp = frame + 1 >= INTRO_FRAMES + MATCH_FRAMES;
  if (dead0 || dead1 || timeUp) {
    const h0 = s[p0 + F_HEALTH] as number;
    const h1 = s[p1 + F_HEALTH] as number;
    if (dead0 !== dead1) s[G_OVER] = dead1 ? OVER_P0 : OVER_P1;
    else if (h0 !== h1) s[G_OVER] = h0 > h1 ? OVER_P0 : OVER_P1;
    else s[G_OVER] = OVER_DRAW;
    events |= dead0 || dead1 ? EV_KO : EV_TIMEUP;
  }
  return events;
}
