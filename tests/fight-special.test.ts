// Special moves, the jump that can clear a swing, and the power factor.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig, GROUND_Y, SPECIAL } from '../src/lib/fight.ts';
import {
  ARENA_W,
  ATTACK_RANGE,
  BOX_W,
  createState,
  EDGE_MARGIN,
  EV_HIT_P1,
  EV_SPECIAL,
  F_COOLDOWN_UNTIL,
  F_FACING,
  F_HEALTH,
  F_PROJ_KIND,
  F_PROJ_X,
  F_PROJ_Y,
  F_SPECIAL,
  F_SPECIAL_UNTIL,
  F_STATE,
  F_X,
  FP,
  fighterBase,
  G_FRAME,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_SPECIAL,
  INTRO_FRAMES,
  PROJ_H,
  type SimState,
  SP_BULLET,
  SP_NONE,
  SP_ORB,
  SP_TELEPORT,
  SP_WAVE,
  SPECIAL_COOLDOWN,
  ST_ATTACK1,
  ST_SPECIAL,
  ST_TAKE_HIT,
  step,
} from '../src/lib/fight-engine/sim.ts';

function fixture(id: string): FighterConfig {
  const fighter = FIGHTERS.find((f) => f.id === id);
  if (!fighter) throw new Error(`fixture fighter ${id} missing`);
  return fighter;
}
const samurai = fixture('samurai-mack');
const kenji = fixture('kenji');
const P0 = fighterBase(0);
const P1 = fighterBase(1);
const at = (s: SimState, i: number): number => s[i] as number;

/** A live match with fighter 0 at x=300 facing right and fighter 1 `gap` px further right. */
function duel(special: number, gap: number, power = 100): SimState {
  const s = createState({ anim: samurai.anim, special, power }, { anim: kenji.anim }, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
  s[P0 + F_X] = 300 * FP;
  s[P1 + F_X] = (300 + gap) * FP;
  s[P0 + F_FACING] = 1;
  s[P1 + F_FACING] = -1;
  return s;
}

/** Steps until `events` contains `bit` (or `limit` frames passed); returns the frames it took. */
function until(s: SimState, bit: number, in0: number, in1 = 0, limit = 400): number {
  for (let i = 1; i <= limit; i++) if (step(s, in0, in1) & bit) return i;
  return -1;
}

test('every fighter has a special move, and no two have the same', () => {
  const kinds = FIGHTERS.map((f) => f.special);
  assert.ok(kinds.every((k) => k !== SPECIAL.none));
  assert.equal(new Set(kinds).size, FIGHTERS.length);
  assert.ok(FIGHTERS.every((f) => f.specialName.length > 0));
});

test('a fighter without a special move ignores the button, and swings if a swing is asked too', () => {
  const s = duel(SP_NONE, 400);
  step(s, IN_SPECIAL, 0);
  assert.notEqual(at(s, P0 + F_STATE), ST_SPECIAL);
  step(s, IN_SPECIAL | IN_ATTACK1, 0);
  assert.equal(at(s, P0 + F_STATE), ST_ATTACK1);
});

test('an unknown special kind is no special move, not a broken one', () => {
  const s = createState({ anim: samurai.anim, special: 99 }, { anim: kenji.anim, special: -1 }, 1);
  assert.equal(at(s, P0 + F_SPECIAL), SP_NONE);
  assert.equal(at(s, P1 + F_SPECIAL), SP_NONE);
});

test('the bullet leaves halfway through the move, flies fast and hits for 8', () => {
  const s = duel(SP_BULLET, 500);
  step(s, IN_SPECIAL, 0);
  assert.equal(at(s, P0 + F_STATE), ST_SPECIAL);
  assert.equal(at(s, P0 + F_PROJ_KIND), SP_NONE, 'nothing in flight during the startup');
  const fired = until(s, EV_SPECIAL, 0);
  assert.ok(fired > 5 && fired < 30, `went off after ${fired} frames`);
  assert.equal(at(s, P0 + F_PROJ_KIND), SP_BULLET);
  const x0 = at(s, P0 + F_PROJ_X);
  step(s, 0, 0);
  assert.equal(at(s, P0 + F_PROJ_X) - x0, 14 * FP);
  const hit = until(s, EV_HIT_P1, 0);
  assert.ok(hit > 0 && hit < 40, `hit after ${hit} more frames`);
  assert.equal(at(s, P1 + F_HEALTH), 92);
  assert.equal(at(s, P1 + F_STATE), ST_TAKE_HIT);
  assert.equal(at(s, P0 + F_PROJ_KIND), SP_NONE, 'the bullet is spent');
});

test('the orb is slow and heavy', () => {
  const s = duel(SP_ORB, 500);
  step(s, IN_SPECIAL, 0);
  until(s, EV_SPECIAL, 0);
  const x0 = at(s, P0 + F_PROJ_X);
  step(s, 0, 0);
  assert.equal(at(s, P0 + F_PROJ_X) - x0, 5 * FP);
  assert.ok(until(s, EV_HIT_P1, 0) > 40, 'it takes its time');
  assert.equal(at(s, P1 + F_HEALTH), 82);
});

test('the wave runs along the ground: a jump clears it, standing does not', () => {
  const standing = duel(SP_WAVE, 400);
  step(standing, IN_SPECIAL, 0);
  until(standing, EV_SPECIAL, 0);
  assert.equal(
    at(standing, P0 + F_PROJ_Y),
    (GROUND_Y - (PROJ_H[SP_WAVE] as number)) * FP,
    'on the ground',
  );
  assert.ok(until(standing, EV_HIT_P1, 0) > 0);
  assert.equal(at(standing, P1 + F_HEALTH), 86);

  // The same wave, and the defender jumps as it arrives.
  const jumping = duel(SP_WAVE, 400);
  step(jumping, IN_SPECIAL, 0);
  until(jumping, EV_SPECIAL, 0);
  let events = 0;
  for (let i = 0; i < 200; i++) {
    const waveX = at(jumping, P0 + F_PROJ_X);
    const near =
      at(jumping, P0 + F_PROJ_KIND) !== SP_NONE && at(jumping, P1 + F_X) - waveX < 80 * FP;
    events |= step(jumping, 0, near ? IN_JUMP : 0);
  }
  assert.equal(events & EV_HIT_P1, 0, 'the wave passed underneath');
  assert.equal(at(jumping, P1 + F_HEALTH), 100);
  assert.equal(at(jumping, P0 + F_PROJ_KIND), SP_NONE, 'and left the arena');
});

test('the teleport lands behind the opponent, facing them, and stays inside the arena', () => {
  const s = duel(SP_TELEPORT, 300);
  step(s, IN_SPECIAL, 0);
  assert.ok(until(s, EV_SPECIAL, 0) > 0);
  const opponent = at(s, P1 + F_X);
  assert.equal(at(s, P0 + F_X), opponent + (BOX_W + 20) * FP);
  assert.equal(at(s, P0 + F_FACING), -1);
  assert.equal(at(s, P0 + F_PROJ_KIND), SP_NONE, 'no projectile');

  // Opponent with its back to the right wall: there is no room behind it.
  const cornered = duel(SP_TELEPORT, 300);
  const wall = (ARENA_W - BOX_W - EDGE_MARGIN) * FP;
  cornered[P1 + F_X] = wall;
  step(cornered, IN_SPECIAL, 0);
  until(cornered, EV_SPECIAL, 0);
  assert.equal(at(cornered, P0 + F_X), wall);
});

test('a special move has its own cooldown and blocks swings while it plays', () => {
  const s = duel(SP_BULLET, 800);
  const started = at(s, G_FRAME);
  step(s, IN_SPECIAL, 0);
  assert.equal(at(s, P0 + F_SPECIAL_UNTIL), started + (SPECIAL_COOLDOWN[SP_BULLET] as number));
  assert.ok(at(s, P0 + F_COOLDOWN_UNTIL) > started + 20);
  step(s, IN_ATTACK1, 0);
  assert.equal(at(s, P0 + F_STATE), ST_SPECIAL, 'no swing in the middle of it');
  // Hold the button: the next one only leaves once the cooldown is over.
  let shots = 0;
  for (let i = 0; i < (SPECIAL_COOLDOWN[SP_BULLET] as number) + 60; i++) {
    if (step(s, IN_SPECIAL, 0) & EV_SPECIAL) shots++;
  }
  assert.equal(shots, 2);
});

test('a hit during the startup cancels the special move, and the cooldown is spent', () => {
  const s = duel(SP_ORB, ATTACK_RANGE);
  // The defender swings first; the orb's startup is longer than that.
  step(s, 0, IN_ATTACK1);
  for (let i = 0; i < 3; i++) step(s, 0, IN_ATTACK1);
  step(s, IN_SPECIAL, IN_ATTACK1);
  assert.equal(at(s, P0 + F_STATE), ST_SPECIAL);
  let events = 0;
  for (let i = 0; i < 60; i++) events |= step(s, 0, 0);
  assert.equal(events & EV_SPECIAL, 0, 'it never went off');
  assert.equal(at(s, P0 + F_PROJ_KIND), SP_NONE);
  assert.ok(at(s, P0 + F_HEALTH) < 100);
  step(s, IN_SPECIAL, 0);
  assert.notEqual(at(s, P0 + F_STATE), ST_SPECIAL, 'still cooling down');
});

test('power scales every kind of damage', () => {
  const swing = duel(SP_NONE, ATTACK_RANGE, 300);
  until(swing, EV_HIT_P1, IN_ATTACK1);
  assert.equal(at(swing, P1 + F_HEALTH), 70);
  const shot = duel(SP_BULLET, 400, 250);
  step(shot, IN_SPECIAL, 0);
  until(shot, EV_HIT_P1, 0);
  assert.equal(at(shot, P1 + F_HEALTH), 80);
});

/**
 * Fighter 0 swings at frame 20; fighter 1 jumps `lead` frames before that
 * (negative: after). Returns whether the swing still hit.
 */
function swingHitsJumper(attacker: FighterConfig, attack: number, lead: number): boolean {
  const s = createState({ anim: attacker.anim }, { anim: kenji.anim }, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
  s[P0 + F_X] = 300 * FP;
  s[P1 + F_X] = (300 + ATTACK_RANGE) * FP;
  s[P0 + F_FACING] = 1;
  let events = 0;
  for (let f = 0; f < 90; f++) {
    events |= step(s, f === 20 ? attack : 0, f === 20 - lead ? IN_JUMP : 0);
  }
  return (events & EV_HIT_P1) !== 0;
}

test('a jump can clear a light swing, but only a well-timed one', () => {
  for (const attacker of [samurai, kenji]) {
    const leads = Array.from({ length: 41 }, (_, i) => i - 10);
    const cleared = leads.filter((lead) => !swingHitsJumper(attacker, IN_ATTACK1, lead));
    assert.ok(cleared.length > 0, `${attacker.id}: no jump clears the light swing`);
    assert.ok(cleared.length < 20, `${attacker.id}: ${cleared.length} of 41 timings clear it`);
    // It has to be a read: jumping once the swing is out is too late.
    assert.ok(
      cleared.every((lead) => lead > 0),
      `${attacker.id}: cleared with leads ${cleared.join(',')}`,
    );
    // Standing still is not an option either.
    assert.equal(swingHitsJumper(attacker, IN_ATTACK1, 1000), true);
  }
});

test('the heavy swing is the answer to a jump', () => {
  const leads = Array.from({ length: 41 }, (_, i) => i - 10);
  const samuraiCleared = leads.filter((lead) => !swingHitsJumper(samurai, IN_ATTACK2, lead));
  assert.deepEqual(samuraiCleared, [], 'the long swing covers the whole jump');
  // The shorter heavy swing can be cleared, by fewer timings than the light one.
  const kenjiHeavy = leads.filter((lead) => !swingHitsJumper(kenji, IN_ATTACK2, lead));
  const kenjiLight = leads.filter((lead) => !swingHitsJumper(kenji, IN_ATTACK1, lead));
  assert.ok(kenjiHeavy.length < kenjiLight.length, `${kenjiHeavy.length} vs ${kenjiLight.length}`);
});
