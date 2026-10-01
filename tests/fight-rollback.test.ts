import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig } from '../src/lib/fight.ts';
import {
  createLoopback,
  type LoopbackOptions,
  RollbackSession,
} from '../src/lib/fight-engine/rollback.ts';
import {
  createState,
  F_HEALTH,
  fighterBase,
  G_OVER,
  hashState,
  type SimState,
  step,
} from '../src/lib/fight-engine/sim.ts';

function fixture(index: number): FighterConfig {
  const fighter = FIGHTERS[index];
  if (!fighter) throw new Error('fixture fighter missing');
  return fighter;
}
const samurai = fixture(0);
const kenji = fixture(2);

/** Random inputs that hold each button for a while, like a person would. */
function inputScript(seed: number): () => number {
  let x = seed | 1;
  let held = 0;
  let framesLeft = 0;
  return () => {
    if (framesLeft-- <= 0) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      held = x & 31;
      framesLeft = (x >>> 8) % 30;
    }
    return held;
  };
}

interface Played {
  a: RollbackSession;
  b: RollbackSession;
  ticks: number;
}

/** Two peers play a whole match against each other over the given network. */
function playMatch(net: LoopbackOptions, seed: number, startOffset = 0): Played {
  const initial: SimState = createState(samurai, kenji, seed);
  const link = createLoopback({ ...net, seed });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
  const inA = inputScript(seed * 31);
  const inB = inputScript(seed * 17);
  let ticks = 0;
  while ((a.outcome === 0 || b.outcome === 0) && ticks < 20_000) {
    a.advance(inA());
    // One peer may get going later than the other, as real peers do.
    if (ticks >= startOffset) b.advance(inB());
    link.tick();
    ticks++;
  }
  return { a, b, ticks };
}

function assertAgreed({ a, b, ticks }: Played): void {
  assert.ok(ticks < 20_000, 'match never finished');
  assert.notEqual(a.outcome, 0);
  assert.equal(a.outcome, b.outcome, 'peers disagree on who won');
  assert.equal(hashState(a.confirmed), hashState(b.confirmed), 'final states differ');
  assert.equal(a.desynced, false);
  assert.equal(b.desynced, false);
}

test('with no latency the peers never have to roll back', () => {
  const played = playMatch({ delay: 0 }, 5);
  assertAgreed(played);
  assert.equal(played.a.stats.rollbacks, 0);
  assert.equal(played.b.stats.rollbacks, 0);
});

test('100ms latency: guesses go wrong, rollbacks fix them, both peers agree', () => {
  const played = playMatch({ delay: 6 }, 11);
  assertAgreed(played);
  assert.ok(played.a.stats.rollbacks > 0, 'expected rollbacks at 100ms');
  assert.ok(played.a.stats.maxRollbackFrames <= 8);
  assert.ok(played.b.stats.maxRollbackFrames <= 8);
});

test('latency with jitter, reordering and 10% packet loss still converges', () => {
  for (const seed of [3, 21, 77, 1234]) {
    assertAgreed(playMatch({ delay: 5, jitter: 4, loss: 0.1 }, seed));
  }
});

test('a peer that starts late is waited for, then both stay in step', () => {
  const played = playMatch({ delay: 3, jitter: 1 }, 9, 20);
  assertAgreed(played);
  assert.ok(played.a.stats.stalledTicks + played.a.stats.syncSkips > 0);
});

test('the prediction window is a hard limit when the peer goes silent', () => {
  const initial = createState(samurai, kenji, 1);
  const link = createLoopback({ delay: 0, loss: 1 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a, maxPrediction: 8 });
  new RollbackSession({ local: 1, state: initial, transport: link.b });
  for (let i = 0; i < 100; i++) {
    a.advance(0);
    link.tick();
  }
  assert.equal(a.frame, 8);
  assert.equal(a.confirmedFrame, 0);
  assert.equal(a.stats.stalledTicks, 92);
});

test('the confirmed state equals an offline replay of the same inputs', () => {
  // Record what each peer actually fed the sim, then replay it without any
  // network: rollback must not change the result, only when it is known.
  const initial = createState(samurai, kenji, 4);
  const link = createLoopback({ delay: 6, jitter: 3, loss: 0.05, seed: 4 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a, inputDelay: 2 });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b, inputDelay: 2 });
  const inA = inputScript(123);
  const inB = inputScript(456);
  const logA: number[] = [0, 0];
  const logB: number[] = [0, 0];
  for (let ticks = 0; (a.outcome === 0 || b.outcome === 0) && ticks < 20_000; ticks++) {
    const fa = a.frame;
    const ia = inA();
    a.advance(ia);
    // An input only counts on a tick that was not a stall.
    if (a.frame > fa) logA[fa + 2] = ia;
    const fb = b.frame;
    const ib = inB();
    b.advance(ib);
    if (b.frame > fb) logB[fb + 2] = ib;
    link.tick();
  }
  const offline = createState(samurai, kenji, 4);
  for (let f = 0; (offline[G_OVER] as number) === 0; f++) step(offline, logA[f] ?? 0, logB[f] ?? 0);
  assert.equal(hashState(offline), hashState(a.confirmed));
  assert.equal(hashState(offline), hashState(b.confirmed));
});

test('peers whose states have diverged notice it', () => {
  const initial = createState(samurai, kenji, 2);
  const link = createLoopback({ delay: 2 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
  // A cosmic ray, a cheat, a non-deterministic bug: one side's truth changes.
  b.confirmed[fighterBase(0) + F_HEALTH] = 37;
  for (let i = 0; i < 300; i++) {
    a.advance(0);
    b.advance(0);
    link.tick();
  }
  assert.ok(a.desynced || b.desynced);
});
