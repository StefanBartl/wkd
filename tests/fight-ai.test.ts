// The opponent's difficulty profiles: what each one does, and that the last
// one cannot be beaten by any of a set of scripted ways to play.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig } from '../src/lib/fight.ts';
import { AI_PROFILES, type AiProfile, aiInput } from '../src/lib/fight-engine/ai.ts';
import {
  ATTACK_RANGE,
  createState,
  EV_HIT_P1,
  EV_SPECIAL,
  F_FACING,
  F_HEALTH,
  F_PROJ_KIND,
  F_STATE,
  F_X,
  FP,
  fighterBase,
  G_FRAME,
  G_OVER,
  IN_ATTACK1,
  IN_ATTACK2,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  IN_SPECIAL,
  INTRO_FRAMES,
  MOVE_SPEED,
  OVER_P0,
  OVER_P1,
  type SimState,
  SP_BULLET,
  SP_NONE,
  SP_ORB,
  SP_WAVE,
  ST_ATTACK1,
  step,
} from '../src/lib/fight-engine/sim.ts';

const P0 = fighterBase(0);
const P1 = fighterBase(1);
const at = (s: SimState, i: number): number => s[i] as number;

function fighter(id: string): FighterConfig {
  const found = FIGHTERS.find((f) => f.id === id);
  if (!found) throw new Error(`fixture fighter ${id} missing`);
  return found;
}

/** A match the way the page sets it up: the player on the left, the AI with its profile's stats. */
function versus(me: FighterConfig, foe: FighterConfig, profile: AiProfile, seed: number): SimState {
  return createState(
    { anim: me.anim, special: me.special },
    {
      anim: foe.anim,
      special: foe.special,
      speed: Math.round(MOVE_SPEED * profile.speed),
      power: profile.power,
    },
    seed,
  );
}

const distance = (s: SimState): number => Math.abs(at(s, P1 + F_X) - at(s, P0 + F_X)) / FP;
const toward = (s: SimState): number => (at(s, P1 + F_X) > at(s, P0 + F_X) ? IN_RIGHT : IN_LEFT);
const away = (s: SimState): number => (at(s, P1 + F_X) > at(s, P0 + F_X) ? IN_LEFT : IN_RIGHT);

function randomButtons(seed: number): () => number {
  let x = seed | 1;
  let held = 0;
  let left = 0;
  return () => {
    if (left-- <= 0) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      held = x & 63;
      left = (x >>> 8) % 30;
    }
    return held;
  };
}

/** Ways a player might try to win, as input scripts for fighter 0. */
const STRATEGIES: Record<string, (seed: number) => (s: SimState) => number> = {
  'stand and hold light': () => () => IN_ATTACK1,
  'stand and hold heavy': () => () => IN_ATTACK2,
  'walk in holding light': () => (s) => (distance(s) > 150 ? toward(s) : 0) | IN_ATTACK1,
  'walk in holding heavy': () => (s) => (distance(s) > 150 ? toward(s) : 0) | IN_ATTACK2,
  'keep turning toward them, hold light': () => (s) =>
    (at(s, G_FRAME) % 30 === 0 ? toward(s) : 0) | IN_ATTACK1,
  'special move, then light': () => (s) =>
    IN_SPECIAL | IN_ATTACK1 | (distance(s) > 170 ? toward(s) : 0),
  'keep away and shoot': () => (s) =>
    (distance(s) < 350 ? away(s) : toward(s)) | IN_SPECIAL | (distance(s) < 180 ? IN_ATTACK1 : 0),
  'jump in with the heavy swing': () => (s) =>
    toward(s) | (at(s, G_FRAME) % 50 < 3 ? IN_JUMP : 0) | IN_ATTACK2,
  'jump their projectiles, hold light': () => (s) =>
    (at(s, P1 + F_PROJ_KIND) !== SP_NONE ? IN_JUMP : 0) |
    (distance(s) < 185 ? IN_ATTACK1 : toward(s)),
  'hit and run': () => (s) => (at(s, G_FRAME) % 90 < 45 ? toward(s) | IN_ATTACK1 : away(s)),
  'mash at random': (seed) => {
    const buttons = randomButtons(seed);
    return () => buttons();
  },
  'play like the hard opponent': () => (s) => aiInput(s, 0, AI_PROFILES.hard),
  'play like the unwinnable one, with normal strength': () => (s) =>
    aiInput(s, 0, AI_PROFILES.unwinnable),
};

/** Outcomes of `strategy` against `profile`, over every pairing of fighters. */
function play(strategy: string, profile: AiProfile, seeds: number): { won: number; total: number } {
  const make = STRATEGIES[strategy];
  if (!make) throw new Error(`no strategy ${strategy}`);
  let won = 0;
  let total = 0;
  for (const me of FIGHTERS) {
    for (const foe of FIGHTERS) {
      for (let seed = 1; seed <= seeds; seed++) {
        const s = versus(me, foe, profile, seed * 7 + total);
        const input = make(seed + total);
        while (at(s, G_OVER) === 0) step(s, input(s), aiInput(s, 1, profile));
        if (at(s, G_OVER) === OVER_P0) won++;
        total++;
      }
    }
  }
  return { won, total };
}

test('unwinnable: no scripted way to play wins a single match, with any pair of fighters', () => {
  for (const strategy of Object.keys(STRATEGIES)) {
    const { won, total } = play(strategy, AI_PROFILES.unwinnable, 3);
    assert.equal(won, 0, `"${strategy}" won ${won} of ${total} matches`);
  }
});

test('unwinnable ends a match against an idle player within seconds', () => {
  for (const foe of FIGHTERS) {
    const s = versus(fighter('samurai-mack'), foe, AI_PROFILES.unwinnable, 5);
    while (at(s, G_OVER) === 0) step(s, 0, aiInput(s, 1, AI_PROFILES.unwinnable));
    assert.equal(at(s, G_OVER), OVER_P1);
    assert.ok(at(s, G_FRAME) < INTRO_FRAMES + 6 * 60, `${foe.id} took ${at(s, G_FRAME)} frames`);
    assert.equal(at(s, P1 + F_HEALTH), 100);
  }
});

test('the levels below it can be beaten, and the harder the level the less often', () => {
  const rate = (profile: AiProfile): number => {
    let won = 0;
    let total = 0;
    for (const strategy of ['walk in holding light', 'hit and run', 'mash at random']) {
      const result = play(strategy, profile, 3);
      won += result.won;
      total += result.total;
    }
    return won / total;
  };
  const easy = rate(AI_PROFILES.easy);
  const normal = rate(AI_PROFILES.normal);
  const hard = rate(AI_PROFILES.hard);
  assert.ok(easy > 0.9, `easy lost only ${easy}`);
  assert.ok(easy >= normal && normal > hard, `easy ${easy}, normal ${normal}, hard ${hard}`);
  assert.ok(hard > 0.2 && hard < 0.8, `hard should be a contest, the scripts won ${hard}`);
});

test('the opponent swings from as far as its blade reaches, not only up close', () => {
  const profile = AI_PROFILES.unwinnable;
  const s = versus(fighter('samurai-mack'), fighter('samurai-mack'), profile, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
  s[P0 + F_X] = 300 * FP;
  // Well beyond where it would stop walking, well within its reach.
  s[P1 + F_X] = (300 + ATTACK_RANGE + 60) * FP;
  s[P1 + F_FACING] = -1;
  step(s, 0, aiInput(s, 1, profile));
  assert.equal(at(s, P1 + F_STATE), ST_ATTACK1);
});

test('the careful opponent does not start a swing that the incoming one would cut short', () => {
  const profile = AI_PROFILES.unwinnable;
  const s = versus(fighter('samurai-mack'), fighter('kenji'), profile, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(s, 0, 0);
  s[P0 + F_X] = 300 * FP;
  s[P1 + F_X] = (300 + ATTACK_RANGE) * FP;
  s[P0 + F_FACING] = 1;
  s[P1 + F_FACING] = -1;
  // The player's swing is two frames old; the slower Kenji cannot beat it.
  step(s, IN_ATTACK1, 0);
  step(s, IN_ATTACK1, 0);
  const input = aiInput(s, 1, profile);
  assert.equal(input & (IN_ATTACK1 | IN_ATTACK2), 0, 'it must hold the swing back');
  // The same opponent, careless: it swings into the blow.
  const careless = { ...profile, careful: false };
  const t = versus(fighter('samurai-mack'), fighter('kenji'), careless, 1);
  for (let i = 0; i < INTRO_FRAMES; i++) step(t, 0, 0);
  t[P0 + F_X] = 300 * FP;
  t[P1 + F_X] = (300 + ATTACK_RANGE) * FP;
  t[P0 + F_FACING] = 1;
  t[P1 + F_FACING] = -1;
  step(t, IN_ATTACK1, 0);
  step(t, IN_ATTACK1, 0);
  assert.notEqual(aiInput(t, 1, careless) & (IN_ATTACK1 | IN_ATTACK2), 0);
});

test('the opponent uses its special move, and the sure-footed ones jump over a projectile', () => {
  // Fighter 0 fires across the arena again and again; the opponent only stands there.
  const jumpsOver = (profile: AiProfile, special: number): number => {
    let hits = 0;
    let shots = 0;
    for (let seed = 1; seed <= 12; seed++) {
      // Rooted to the spot: from point-blank range nothing can be dodged.
      const quiet = { ...profile, attackChance: 0, specialChance: 0, speed: 0 };
      const s = createState(
        { anim: fighter('samurai-mack').anim, special },
        { anim: fighter('kenji').anim, speed: Math.round(MOVE_SPEED * quiet.speed) },
        seed,
      );
      for (let i = 0; i < 600 && at(s, G_OVER) === 0; i++) {
        const events = step(s, IN_SPECIAL, aiInput(s, 1, quiet));
        if (events & EV_SPECIAL) shots++;
        if (events & EV_HIT_P1) hits++;
      }
    }
    assert.ok(shots > 10, 'the script must actually shoot');
    return hits / shots;
  };
  for (const special of [SP_BULLET, SP_ORB, SP_WAVE]) {
    assert.equal(jumpsOver(AI_PROFILES.unwinnable, special), 0, `kind ${special}: never hit`);
    assert.ok(jumpsOver(AI_PROFILES.easy, special) > 0.9, `kind ${special}: easy does not dodge`);
  }

  let fired = 0;
  const s = versus(fighter('kenji'), fighter('ronin'), AI_PROFILES.hard, 3);
  for (let i = 0; i < 900 && at(s, G_OVER) === 0; i++) {
    // The player keeps its distance, so the opponent has reason to shoot.
    if (step(s, away(s), aiInput(s, 1, AI_PROFILES.hard)) & EV_SPECIAL) fired++;
  }
  assert.ok(fired > 0, 'the hard opponent never used its special move');
});
