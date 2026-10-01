import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, GROUND_Y } from '../src/lib/fight.ts';
import { aiInput } from '../src/lib/fight-engine/ai.ts';
import {
  ARENA_W,
  ATTACK_RANGE,
  BOX_H,
  BOX_W,
  cloneState,
  copyState,
  createState,
  EDGE_MARGIN,
  EV_FIGHT,
  EV_HIT_P0,
  EV_HIT_P1,
  EV_KO,
  EV_LAND_P0,
  EV_TIMEUP,
  F_ANIM_FRAME,
  F_FACING,
  F_HEALTH,
  F_STATE,
  F_X,
  F_Y,
  FP,
  fighterBase,
  G_OVER,
  G_RNG,
  hashState,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  INTRO_FRAMES,
  MATCH_FRAMES,
  MOVE_SPEED,
  OVER_DRAW,
  OVER_P0,
  OVER_P1,
  type SimState,
  ST_ATTACK1,
  ST_DEATH,
  ST_TAKE_HIT,
  secondsLeft,
  step,
} from '../src/lib/fight-engine/sim.ts';

const samurai = FIGHTERS[0];
const kenji = FIGHTERS[2];
if (!samurai || !kenji) throw new Error('fixture fighters missing');
const P0 = fighterBase(0);
const P1 = fighterBase(1);

const fresh = (seed = 1): SimState => createState(samurai, kenji, seed);
const at = (s: SimState, i: number): number => s[i] as number;

function skipIntro(s: SimState): void {
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
}

/** Put the two fighters within striking distance, facing each other. */
function faceOff(s: SimState): void {
  s[P0 + F_X] = 400 * FP;
  s[P1 + F_X] = (400 + ATTACK_RANGE) * FP;
  s[P0 + F_FACING] = 1;
  s[P1 + F_FACING] = -1;
}

function run(s: SimState, frames: number, in0: number, in1 = 0): number {
  let events = 0;
  for (let i = 0; i < frames; i++) events |= step(s, in0, in1);
  return events;
}

test('intro ignores input and announces its end exactly once', () => {
  const s = fresh();
  const x = at(s, P0 + F_X);
  let fights = 0;
  for (let i = 0; i < INTRO_FRAMES; i++) {
    if (step(s, IN_RIGHT | IN_ATTACK1, 0) & EV_FIGHT) fights++;
  }
  assert.equal(at(s, P0 + F_X), x);
  assert.equal(fights, 1);
  assert.equal(step(s, 0, 0) & EV_FIGHT, 0);
});

test('movement is a fixed distance per frame and stops at the arena edge', () => {
  const s = fresh();
  skipIntro(s);
  const x = at(s, P0 + F_X);
  run(s, 10, IN_RIGHT);
  assert.equal(at(s, P0 + F_X), x + 10 * MOVE_SPEED);
  assert.equal(at(s, P0 + F_FACING), 1);
  run(s, 600, IN_LEFT);
  assert.equal(at(s, P0 + F_X), 10 * FP);
  assert.equal(at(s, P0 + F_FACING), -1);
});

test('a jump leaves the ground, cannot be repeated mid-air, and lands again', () => {
  const s = fresh();
  skipIntro(s);
  const ground = (GROUND_Y - BOX_H) * FP;
  step(s, IN_JUMP, 0);
  const firstRise = at(s, P0 + F_Y);
  assert.ok(firstRise < ground);
  let apex = firstRise;
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) {
    // Holding jump the whole time must not add a second jump in the air.
    landed = (step(s, IN_JUMP, 0) & EV_LAND_P0) !== 0;
    apex = Math.min(apex, at(s, P0 + F_Y));
  }
  assert.ok(landed);
  assert.equal(at(s, P0 + F_Y), ground);
  const height = (ground - apex) / FP;
  assert.ok(height > 120 && height < 160, `jump height ${height}px`);
});

test('an attack in range lands once per swing; out of range it misses', () => {
  const s = fresh();
  skipIntro(s);
  faceOff(s);
  const events = run(s, 40, IN_ATTACK1);
  assert.ok(events & EV_HIT_P1);
  assert.equal(at(s, P1 + F_HEALTH), 80, 'two swings fit in 40 frames, 10 damage each');

  const far = fresh();
  skipIntro(far);
  assert.equal(run(far, 40, IN_ATTACK1) & EV_HIT_P1, 0);
  assert.equal(at(far, P1 + F_HEALTH), 100);
});

test('an attack facing away from the opponent misses', () => {
  const s = fresh();
  skipIntro(s);
  faceOff(s);
  s[P0 + F_FACING] = -1;
  assert.equal(run(s, 40, IN_ATTACK1) & EV_HIT_P1, 0);
});

test('the heavy attack hurts more and a hit stuns, then releases', () => {
  const s = fresh();
  skipIntro(s);
  faceOff(s);
  let hitFrame = -1;
  for (let i = 0; i < 40 && hitFrame < 0; i++) {
    if (step(s, i === 0 ? IN_ATTACK2 : 0, 0) & EV_HIT_P1) hitFrame = i;
  }
  assert.ok(hitFrame >= 0);
  assert.equal(at(s, P1 + F_HEALTH), 78);
  assert.equal(at(s, P1 + F_STATE), ST_TAKE_HIT);
  run(s, 30, 0);
  assert.notEqual(at(s, P1 + F_STATE), ST_TAKE_HIT, 'stun must wear off');
});

test('a same-frame trade hurts both fighters', () => {
  const s = createState(samurai, samurai, 1);
  skipIntro(s);
  faceOff(s);
  const events = run(s, 40, IN_ATTACK1, IN_ATTACK1);
  assert.ok(events & EV_HIT_P0);
  assert.ok(events & EV_HIT_P1);
  assert.equal(at(s, P0 + F_HEALTH), at(s, P1 + F_HEALTH));
});

test('a knockout ends the match and freezes the state', () => {
  const s = fresh();
  skipIntro(s);
  faceOff(s);
  let events = 0;
  for (let i = 0; i < 2000 && at(s, G_OVER) === 0; i++) events |= step(s, IN_ATTACK2, 0);
  assert.equal(at(s, G_OVER), OVER_P0);
  assert.ok(events & EV_KO);
  assert.equal(at(s, P1 + F_STATE), ST_DEATH);
  const hash = hashState(s);
  run(s, 10, IN_RIGHT, IN_LEFT);
  assert.equal(hashState(s), hash);
});

test('time-up is decided by health, a tie is a draw', () => {
  const draw = fresh();
  const events = run(draw, INTRO_FRAMES + MATCH_FRAMES, 0);
  assert.ok(events & EV_TIMEUP);
  assert.equal(at(draw, G_OVER), OVER_DRAW);
  assert.equal(secondsLeft(draw), 0);

  const lead = fresh();
  skipIntro(lead);
  lead[P0 + F_HEALTH] = 40;
  run(lead, MATCH_FRAMES, 0);
  assert.equal(at(lead, G_OVER), OVER_P1);
});

test('the clock shows whole seconds and only runs after the intro', () => {
  const s = fresh();
  assert.equal(secondsLeft(s), 60);
  skipIntro(s);
  assert.equal(secondsLeft(s), 60);
  // The first full second after the intro: 59 shows at 60 frames in, not at
  // 60 frames from frame 0 -- the intro is shorter than a second, so only
  // this frame tells a clock that waits for the intro from one that does not.
  run(s, 59, 0);
  assert.equal(secondsLeft(s), 60);
  run(s, 1, 0);
  assert.equal(secondsLeft(s), 59);
});

test('same seed and inputs give the same match; clone and restore replays it', () => {
  const script = (i: number): number =>
    (i % 7 < 3 ? IN_RIGHT : 0) | (i % 50 === 0 ? IN_JUMP : 0) | (i % 13 === 0 ? IN_ATTACK1 : 0);
  const play = (s: SimState, from: number, to: number): void => {
    for (let i = from; i < to; i++) step(s, script(i), aiInput(s, 1));
  };
  const a = fresh(42);
  const b = fresh(42);
  play(a, 0, 900);
  play(b, 0, 400);
  const snapshot = cloneState(b);
  play(b, 400, 900);
  assert.equal(hashState(a), hashState(b));

  copyState(b, snapshot);
  play(b, 400, 900);
  assert.equal(hashState(a), hashState(b));

  // The seed itself is part of the hashed state, so compare without it: the
  // matches must differ in what was played, not just in the number put in.
  const played = (s: SimState): number => {
    const copy = cloneState(s);
    copy[G_RNG] = 0;
    return hashState(copy);
  };
  const differing = [43, 44, 45].filter((seed) => {
    const other = fresh(seed);
    play(other, 0, 900);
    return played(a) !== played(other);
  });
  assert.ok(differing.length > 0, 'different seeds must play differently');
});

test('the AI walks up to its opponent and actually lands hits', () => {
  const s = fresh(7);
  let events = 0;
  for (let i = 0; i < INTRO_FRAMES + 20 * 60 && at(s, G_OVER) === 0; i++) {
    events |= step(s, 0, aiInput(s, 1));
  }
  assert.ok(events & EV_HIT_P0, 'an idle player must get hit within 20 seconds');
  assert.ok(at(s, P0 + F_HEALTH) < 100);
});

test('the blade is only out in the middle of a swing', () => {
  const frames = samurai.anim.attack1.frames;
  const s = fresh();
  skipIntro(s);
  faceOff(s);
  let animFrame = -1;
  for (let i = 0; i < 60 && animFrame < 0; i++) {
    if (step(s, IN_ATTACK1, 0) & EV_HIT_P1) animFrame = at(s, P0 + F_ANIM_FRAME);
  }
  assert.ok(animFrame >= Math.floor((frames * 3) / 10), `hit on swing frame ${animFrame}`);
  assert.ok(animFrame <= Math.ceil((frames * 8) / 10), `hit on swing frame ${animFrame}`);
  assert.ok(animFrame > 0, 'a swing must not hurt before the blade is out');
});

test('walking right stops at the right arena edge too', () => {
  const s = fresh();
  skipIntro(s);
  run(s, 600, IN_RIGHT);
  assert.equal(at(s, P0 + F_X), (ARENA_W - BOX_W - EDGE_MARGIN) * FP);
});

test('the fighters start on opposite sides, facing each other', () => {
  const s = fresh();
  assert.equal(at(s, P0 + F_FACING), 1);
  assert.equal(at(s, P1 + F_FACING), -1);
  assert.equal(at(s, P0 + F_X), 180 * FP);
  assert.equal(at(s, P1 + F_X), (ARENA_W - 180 - BOX_W) * FP);
});

test('a fighter set up with its own speed walks at it, the other at the default', () => {
  const s = createState(samurai, { anim: kenji.anim, speed: 100 }, 1);
  skipIntro(s);
  const x0 = at(s, P0 + F_X);
  const x1 = at(s, P1 + F_X);
  run(s, 10, IN_RIGHT, IN_LEFT);
  assert.equal(at(s, P0 + F_X), x0 + 10 * MOVE_SPEED);
  assert.equal(at(s, P1 + F_X), x1 - 10 * 100);
});

test('with both attack buttons down the light attack wins', () => {
  const s = fresh();
  skipIntro(s);
  step(s, IN_ATTACK1 | IN_ATTACK2, 0);
  assert.equal(at(s, P0 + F_STATE), ST_ATTACK1);
});

test('the AI does nothing while it is stunned or down', () => {
  const s = fresh(5);
  skipIntro(s);
  assert.notEqual(aiInput(s, 1), 0, 'a free AI far from its opponent walks');
  for (const state of [ST_TAKE_HIT, ST_DEATH]) {
    s[P1 + F_STATE] = state;
    assert.equal(aiInput(s, 1), 0);
  }
});

test('the AI turns around when its opponent ends up behind it', () => {
  const s = fresh(3);
  skipIntro(s);
  s[P1 + F_X] = 400 * FP;
  s[P0 + F_X] = (400 + ATTACK_RANGE) * FP; // opponent on the right, in range
  s[P1 + F_FACING] = -1;
  step(s, 0, aiInput(s, 1));
  assert.equal(at(s, P1 + F_FACING), 1);
});
