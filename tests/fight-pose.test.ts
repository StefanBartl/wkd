import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig } from '../src/lib/fight.ts';
import { AI_PROFILES, aiInput, isDifficulty } from '../src/lib/fight-engine/ai.ts';
import { pose } from '../src/lib/fight-engine/pose.ts';
import {
  ATTACK_RANGE,
  createState,
  F_ANIM_FRAME,
  F_FACING,
  F_HEALTH,
  F_STATE,
  F_X,
  FP,
  fighterBase,
  G_OVER,
  IN_ATTACK2,
  INTRO_FRAMES,
  MOVE_SPEED,
  type SimState,
  ST_ATTACK1,
  ST_DEATH,
  ST_RUN,
  step,
} from '../src/lib/fight-engine/sim.ts';

function fixture(index: number): FighterConfig {
  const fighter = FIGHTERS[index];
  if (!fighter) throw new Error('fixture fighter missing');
  return fighter;
}
const samurai = fixture(0);
const kenji = fixture(2);
const P0 = fighterBase(0);
const P1 = fighterBase(1);

/** A match played until fighter 0 has knocked fighter 1 out. */
function knockout(): SimState {
  const s = createState(samurai, kenji, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
  s[P0 + F_X] = 400 * FP;
  s[P1 + F_X] = (400 + ATTACK_RANGE) * FP;
  s[P0 + F_FACING] = 1;
  for (let i = 0; i < 2000 && s[G_OVER] === 0; i++) step(s, IN_ATTACK2, 0);
  assert.equal(s[P1 + F_STATE], ST_DEATH);
  return s;
}

test('while the match runs the pose is the sim state, untouched', () => {
  const s = createState(samurai, kenji, 1);
  s[P0 + F_STATE] = ST_RUN;
  s[P0 + F_ANIM_FRAME] = 5;
  assert.deepEqual(pose(s, P0, samurai.anim), { key: 'run', frame: 5 });
  assert.deepEqual(pose(s, P0, samurai.anim, -1), { key: 'run', frame: 5 });
});

test('the sim stops on the knockout frame; the outro plays the fall and holds its last frame', () => {
  const s = knockout();
  const death = kenji.anim.death;
  // The sim itself never gets past the first frame of the fall.
  assert.equal(s[P1 + F_ANIM_FRAME], 0);
  step(s, 0, 0);
  assert.equal(s[P1 + F_ANIM_FRAME], 0);

  assert.deepEqual(pose(s, P1, kenji.anim, 0), { key: 'death', frame: 0 });
  assert.deepEqual(pose(s, P1, kenji.anim, death.hold), { key: 'death', frame: 1 });
  const last = death.frames - 1;
  assert.deepEqual(pose(s, P1, kenji.anim, death.hold * last), { key: 'death', frame: last });
  assert.deepEqual(pose(s, P1, kenji.anim, 10_000), { key: 'death', frame: last });
});

test('the winner finishes the swing that decided it, then stands', () => {
  const s = knockout();
  const swing = samurai.anim.attack2;
  const at = s[P0 + F_ANIM_FRAME] as number;
  assert.ok(at > 0 && at < swing.frames - 1, `the blow landed on swing frame ${at}`);
  assert.deepEqual(pose(s, P0, samurai.anim, 0), { key: 'attack2', frame: at });
  assert.deepEqual(pose(s, P0, samurai.anim, swing.hold), { key: 'attack2', frame: at + 1 });
  // Past the swing's last frame: idle, looping.
  const after = swing.hold * (swing.frames - at);
  const idle = samurai.anim.idle;
  assert.equal(pose(s, P0, samurai.anim, after).key, 'idle');
  assert.ok(pose(s, P0, samurai.anim, after).frame < idle.frames);
  assert.equal(pose(s, P0, samurai.anim, idle.hold * idle.frames).frame, 0, 'idle loops');
});

test('a fighter that was walking when the clock ran out stands still in the outro', () => {
  const s = createState(samurai, kenji, 1);
  s[P0 + F_STATE] = ST_RUN;
  s[P0 + F_ANIM_FRAME] = 3;
  assert.equal(pose(s, P0, samurai.anim, 0).key, 'idle');
  s[P0 + F_STATE] = ST_ATTACK1;
  s[P0 + F_ANIM_FRAME] = samurai.anim.attack1.frames - 1;
  assert.deepEqual(pose(s, P0, samurai.anim, 0), {
    key: 'attack1',
    frame: samurai.anim.attack1.frames - 1,
  });
});

/** Health an idle player has left after `seconds` against the AI, averaged over seeds. */
function idleHealthAfter(difficulty: keyof typeof AI_PROFILES, seconds: number): number {
  const profile = AI_PROFILES[difficulty];
  let total = 0;
  const seeds = 40;
  for (let seed = 1; seed <= seeds; seed++) {
    const s = createState(
      samurai,
      { anim: kenji.anim, speed: Math.round(MOVE_SPEED * profile.speed) },
      seed,
    );
    for (let i = 0; i < INTRO_FRAMES + seconds * 60 && s[G_OVER] === 0; i++) {
      step(s, 0, aiInput(s, 1, profile));
    }
    total += s[P0 + F_HEALTH] as number;
  }
  return total / seeds;
}

test('easy hurts less than normal, normal less than hard', () => {
  const easy = idleHealthAfter('easy', 12);
  const normal = idleHealthAfter('normal', 12);
  const hard = idleHealthAfter('hard', 12);
  assert.ok(easy > normal + 5, `easy ${easy} vs normal ${normal}`);
  assert.ok(normal > hard + 5, `normal ${normal} vs hard ${hard}`);
  // Even on easy the opponent is not a punching bag.
  assert.ok(easy < 100, 'the easy AI never landed a hit');
});

test('the default profile is the hard one, and the names are the only valid ones', () => {
  const a = createState(samurai, kenji, 9);
  const b = createState(samurai, kenji, 9);
  for (let i = 0; i < 900; i++) {
    step(a, 0, aiInput(a, 1));
    step(b, 0, aiInput(b, 1, AI_PROFILES.hard));
  }
  assert.deepEqual([...a], [...b]);
  assert.equal(isDifficulty('normal'), true);
  assert.equal(isDifficulty('nightmare'), false);
  assert.equal(isDifficulty('toString'), false);
  assert.equal(isDifficulty(null), false);
});
