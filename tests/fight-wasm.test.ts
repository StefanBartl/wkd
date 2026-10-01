// Holds the committed fight-sim.wasm (Rust, wasm/fight-sim) and sim.ts to
// the same state on every frame. If this fails after a change to either,
// port the change to the other and run `pnpm build:wasm`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FIGHTERS } from '../src/lib/fight.ts';
import { aiInput } from '../src/lib/fight-engine/ai.ts';
import {
  createState,
  EV_HIT_P0,
  EV_HIT_P1,
  EV_KO,
  EV_LAND_P0,
  EV_SPECIAL,
  EV_TIMEUP,
  F_PROJ_KIND,
  fighterBase,
  G_OVER,
  hashState,
  step,
} from '../src/lib/fight-engine/sim.ts';
import { instantiateSim } from '../src/lib/fight-engine/wasm.ts';

const wasm = new WebAssembly.Module(
  readFileSync(new URL('../src/lib/fight-engine/fight-sim.wasm', import.meta.url)),
);

/** Random inputs that hold each button for a while, so fighters actually travel and trade. */
function inputScript(seed: number): () => number {
  let x = seed | 1;
  let held = 0;
  let framesLeft = 0;
  return () => {
    if (framesLeft-- <= 0) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      // All six buttons, the special move included.
      held = x & 63;
      framesLeft = (x >>> 8) % 40;
    }
    return held;
  };
}

test('the Rust/WASM step matches the TypeScript step on every frame', () => {
  let frames = 0;
  let seen = 0;
  const outcomes = new Set<number>();
  const projectiles = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    const a = FIGHTERS[seed % FIGHTERS.length];
    const b = FIGHTERS[(seed + 1) % FIGHTERS.length];
    if (!a || !b) throw new Error('fixture fighters missing');
    // Every fourth match one side hits harder, as the unwinnable opponent does.
    const js = createState(a, seed % 4 === 0 ? { ...b, power: 300 } : b, seed);
    const rust = instantiateSim(wasm, js);
    const in0 = inputScript(seed * 7919);
    const in1 = inputScript(seed * 104729);
    // Every third match is played against the AI instead of random input.
    const versusAi = seed % 3 === 0;
    while ((js[G_OVER] as number) === 0) {
      const i0 = in0();
      const i1 = versusAi ? aiInput(js, 1) : in1();
      if (versusAi) assert.equal(aiInput(rust.state, 1), i1, `AI input, seed ${seed}`);
      const evJs = step(js, i0, i1);
      const evRust = rust.step(i0, i1);
      frames++;
      seen |= evJs;
      projectiles.add(js[fighterBase(0) + F_PROJ_KIND] as number);
      projectiles.add(js[fighterBase(1) + F_PROJ_KIND] as number);
      if (evJs !== evRust || hashState(js) !== hashState(rust.state)) {
        assert.deepEqual(Array.from(rust.state), Array.from(js), `seed ${seed}, frame ${frames}`);
        assert.equal(evRust, evJs, `events, seed ${seed}, frame ${frames}`);
      }
    }
    outcomes.add(js[G_OVER] as number);
  }
  // The comparison only means something if the matches got somewhere.
  assert.ok(frames > 50_000, `only ${frames} frames simulated`);
  for (const ev of [EV_HIT_P0, EV_HIT_P1, EV_LAND_P0, EV_KO, EV_TIMEUP, EV_SPECIAL]) {
    assert.ok(seen & ev, `event ${ev} never occurred`);
  }
  assert.ok(outcomes.size >= 2, 'matches should not all end the same way');
  // Nothing in flight, bullet, orb and wave: every projectile was compared.
  assert.equal(projectiles.size, 4, `projectile kinds seen: ${[...projectiles].join(',')}`);
});
