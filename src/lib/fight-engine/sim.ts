// Deterministic simulation core of the fight minigame: plain integers in,
// plain integers out. No DOM, no wall clock, no Math.random, no floats --
// the whole match lives in one Int32Array so it can be copied (rollback),
// hashed (desync checks), sent over the wire and handed to a WASM build of
// this same file's step() without translation. Rendering, audio and input
// collection live in src/scripts/fight.ts and only read this state.
//
// Relative imports carry their .ts extension and the file sticks to erasable
// TypeScript so plain `node --test` can run it.
import { type AnimKey, CANVAS, type FighterConfig, GROUND_Y, MATCH_SECONDS } from '../fight.ts';

/** Fixed-point scale for positions and velocities: 1 px = 256 units. */
export const FP = 256;
export const SIM_HZ = 60;

export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_JUMP = 4;
export const IN_ATTACK1 = 8;
export const IN_ATTACK2 = 16;

export const ST_IDLE = 0;
export const ST_RUN = 1;
export const ST_JUMP = 2;
export const ST_FALL = 3;
export const ST_ATTACK1 = 4;
export const ST_ATTACK2 = 5;
export const ST_TAKE_HIT = 6;
export const ST_DEATH = 7;

/** Index = ST_* value; the renderer maps a state to its sprite sheet with this. */
export const STATE_ANIM: readonly AnimKey[] = [
  'idle',
  'run',
  'jump',
  'fall',
  'attack1',
  'attack2',
  'takeHit',
  'death',
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

export const OVER_NONE = 0;
export const OVER_P0 = 1;
export const OVER_P1 = 2;
export const OVER_DRAW = 3;

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
/** 8 x (frames, hold), indexed by ST_*: per-fighter config, constant per match. */
export const F_ANIM_CFG = 16;
export const FIGHTER_SIZE = 32;

export const STATE_LEN = GLOBAL_SIZE + 2 * FIGHTER_SIZE;
export type SimState = Int32Array;

export const fighterBase = (index: 0 | 1): number => GLOBAL_SIZE + index * FIGHTER_SIZE;

// ---- tuning (all in px or frames, converted once) -----------------------
export const ARENA_W = CANVAS.w;
export const BOX_W = 90;
export const BOX_H = 190;
export const ATTACK_RANGE = 90;
const ATTACK_W = 100;
const ATTACK_H = 60;
const ATTACK_Y_OFFSET = 30;
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

const GROUND_FP = GROUND_Y * FP;
const BOX_H_FP = BOX_H * FP;
const MIN_X_FP = EDGE_MARGIN * FP;
const MAX_X_FP = (ARENA_W - BOX_W - EDGE_MARGIN) * FP;

export interface FighterSetup {
  readonly anim: FighterConfig['anim'];
  /** Horizontal speed in FP units per frame; defaults to MOVE_SPEED. */
  readonly speed?: number;
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

const isAttack = (st: number): boolean => st === ST_ATTACK1 || st === ST_ATTACK2;
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
  if (isAttack(cur) && (s[b + F_ANIM_FRAME] as number) < animFrames(s, b, cur) - 1) return;
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
  const swingDone = isAttack(st) && (s[b + F_ANIM_FRAME] as number) >= animFrames(s, b, st) - 1;
  if (!isAttack(st) || swingDone) {
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

/** Damage the attacker lands on the defender this frame, 0 for none. */
function landedDamage(s: SimState, atk: number, def: number): number {
  const st = s[atk + F_STATE] as number;
  if (!isAttack(st) || s[atk + F_DID_HIT] !== 0 || s[def + F_STATE] === ST_DEATH) return 0;
  const frames = animFrames(s, atk, st);
  const frame = s[atk + F_ANIM_FRAME] as number;
  // The middle of the swing is where the blade is actually out.
  if (frame < Math.floor((frames * 3) / 10) || frame > Math.ceil((frames * 8) / 10)) return 0;
  const ax0 =
    s[atk + F_FACING] === 1
      ? (s[atk + F_X] as number) + BOX_W * FP
      : (s[atk + F_X] as number) - ATTACK_W * FP;
  const ay0 = (s[atk + F_Y] as number) + ATTACK_Y_OFFSET * FP;
  const dx0 = s[def + F_X] as number;
  const dy0 = s[def + F_Y] as number;
  const overlap =
    ax0 < dx0 + BOX_W * FP &&
    ax0 + ATTACK_W * FP > dx0 &&
    ay0 < dy0 + BOX_H_FP &&
    ay0 + ATTACK_H * FP > dy0;
  if (!overlap) return 0;
  return st === ST_ATTACK1 ? ATTACK1_DAMAGE : ATTACK2_DAMAGE;
}

function applyHit(s: SimState, atk: number, def: number, damage: number): void {
  s[atk + F_DID_HIT] = 1;
  const health = Math.max(0, (s[def + F_HEALTH] as number) - damage);
  s[def + F_HEALTH] = health;
  s[def + F_HIT_UNTIL] = (s[G_FRAME] as number) + HIT_STUN_FRAMES;
  enterState(s, def, health <= 0 ? ST_DEATH : ST_TAKE_HIT);
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

  // Both swings are judged against the pre-hit state and only then applied,
  // so a same-frame trade hurts both sides instead of favouring fighter 0.
  const dmgTo1 = landedDamage(s, p0, p1);
  const dmgTo0 = landedDamage(s, p1, p0);
  if (dmgTo1 > 0) {
    applyHit(s, p0, p1, dmgTo1);
    events |= EV_HIT_P1;
  }
  if (dmgTo0 > 0) {
    applyHit(s, p1, p0, dmgTo0);
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
