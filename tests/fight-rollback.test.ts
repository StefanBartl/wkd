import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig } from '../src/lib/fight.ts';
import {
  createLoopback,
  type LoopbackOptions,
  RollbackSession,
} from '../src/lib/fight-engine/rollback.ts';
import {
  cloneState,
  createState,
  EV_HIT_P0,
  EV_HIT_P1,
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
  const logA: number[] = [];
  const logB: number[] = [];
  for (let ticks = 0; (a.outcome === 0 || b.outcome === 0) && ticks < 20_000; ticks++) {
    // A session takes the first input it is given for each frame -- on a
    // stalled tick the frame does not move, and later samples are ignored.
    const recordsA = a.wantsInput;
    const fa = a.frame;
    const ia = inA();
    a.advance(ia);
    if (recordsA) logA[fa + 2] = ia;
    const recordsB = b.wantsInput;
    const fb = b.frame;
    const ib = inB();
    b.advance(ib);
    if (recordsB) logB[fb + 2] = ib;
    link.tick();
  }
  const offline = createState(samurai, kenji, 4);
  for (let f = 0; (offline[G_OVER] as number) === 0; f++) step(offline, logA[f] ?? 0, logB[f] ?? 0);
  assert.equal(hashState(offline), hashState(a.confirmed));
  assert.equal(hashState(offline), hashState(b.confirmed));
});

/** What `current` must be: confirmed, then the rest of the frames with the guessed remote input. */
function expectedPresent(
  session: RollbackSession,
  local: 0 | 1,
  localLog: readonly number[],
  remoteLog: readonly number[],
): SimState {
  const state = cloneState(session.confirmed);
  const known = session.remoteFrames;
  const guess = known > 0 ? (remoteLog[known - 1] ?? 0) : 0;
  for (let f = session.confirmedFrame; f < session.frame; f++) {
    const remote = f < known ? (remoteLog[f] ?? 0) : guess;
    const mine = localLog[f] ?? 0;
    if (local === 0) step(state, mine, remote);
    else step(state, remote, mine);
  }
  return state;
}

test('the rendered present is always confirmed plus the guessed frames -- rollback really rewinds', () => {
  const initial = createState(samurai, kenji, 8);
  const link = createLoopback({ delay: 5, jitter: 3, loss: 0.1, seed: 8 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
  const inA = inputScript(81);
  const inB = inputScript(82);
  const logA: number[] = [];
  const logB: number[] = [];
  let checked = 0;
  for (let ticks = 0; (a.outcome === 0 || b.outcome === 0) && ticks < 20_000; ticks++) {
    const recordsA = a.wantsInput;
    const fa = a.frame;
    const ia = inA();
    a.advance(ia);
    if (recordsA) logA[fa + 2] = ia;
    const recordsB = b.wantsInput;
    const fb = b.frame;
    const ib = inB();
    b.advance(ib);
    if (recordsB) logB[fb + 2] = ib;
    // Without the rewind, a wrong guess would stay baked into `current`.
    assert.equal(
      hashState(a.current),
      hashState(expectedPresent(a, 0, logA, logB)),
      `A at tick ${ticks}`,
    );
    assert.equal(
      hashState(b.current),
      hashState(expectedPresent(b, 1, logB, logA)),
      `B at tick ${ticks}`,
    );
    checked++;
    link.tick();
  }
  assert.ok(checked > 600, 'the match was too short to prove anything');
  assert.ok(a.stats.rollbacks > 0 && b.stats.rollbacks > 0);
});

test('a hit that only shows up in a rollback replay is still reported', () => {
  let real = 0;
  let reported = 0;
  for (const seed of [3, 11, 21, 77]) {
    const initial = createState(samurai, kenji, seed);
    const link = createLoopback({ delay: 6, seed });
    const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
    const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
    const inA = inputScript(seed * 5);
    const inB = inputScript(seed * 7);
    const logA: number[] = [];
    const logB: number[] = [];
    for (let ticks = 0; (a.outcome === 0 || b.outcome === 0) && ticks < 20_000; ticks++) {
      const recordsA = a.wantsInput;
      const fa = a.frame;
      const ia = inA();
      const events = a.advance(ia);
      if (recordsA) logA[fa + 2] = ia;
      if (events & (EV_HIT_P0 | EV_HIT_P1)) reported++;
      const recordsB = b.wantsInput;
      const fb = b.frame;
      const ib = inB();
      b.advance(ib);
      if (recordsB) logB[fb + 2] = ib;
      link.tick();
    }
    const offline = createState(samurai, kenji, seed);
    for (let f = 0; (offline[G_OVER] as number) === 0; f++) {
      const events = step(offline, logA[f] ?? 0, logB[f] ?? 0);
      if (events & (EV_HIT_P0 | EV_HIT_P1)) real++;
    }
  }
  assert.ok(real > 20, 'too few hits in the sample to prove anything');
  // Phantoms (a predicted hit that rollback took back) are allowed; misses are not.
  assert.ok(reported >= real, `${real - reported} of ${real} real hits were never reported`);
});

test('a peer that stops once its result is final does not strand the other one', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const initial = createState(samurai, kenji, seed);
    const link = createLoopback({ delay: 4, jitter: 2, loss: 0.5, seed });
    const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
    const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
    const inA = inputScript(seed * 3);
    const inB = inputScript(seed * 9);
    let ticks = 0;
    for (; (a.outcome === 0 || b.outcome === 0) && ticks < 20_000; ticks++) {
      // What the page does: the loop stops at the result, flush() keeps the
      // last inputs going out a few times a second.
      if (a.outcome === 0) a.advance(inA());
      else if (ticks % 6 === 0) a.flush();
      if (b.outcome === 0) b.advance(inB());
      else if (ticks % 6 === 0) b.flush();
      link.tick();
    }
    assert.ok(ticks < 20_000, `seed ${seed}: one peer never learned the result`);
    assert.equal(a.outcome, b.outcome);
  }
});

test('diverged peers stop playing instead of reporting different winners', () => {
  const initial = createState(samurai, kenji, 2);
  const link = createLoopback({ delay: 2 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
  b.confirmed[fighterBase(0) + F_HEALTH] = 37;
  for (let i = 0; i < 300 && !(a.desynced && b.desynced); i++) {
    a.advance(0);
    b.advance(0);
    link.tick();
  }
  assert.ok(a.desynced || b.desynced);
  for (const session of [a, b]) {
    if (!session.desynced) continue;
    const frozenAt = session.frame;
    for (let i = 0; i < 60; i++) {
      assert.equal(session.advance(0), 0);
      link.tick();
    }
    assert.equal(session.frame, frozenAt, 'a desynced session must not keep stepping');
  }
});

test('a tick that will not record its input says so, so a tap can wait', () => {
  const initial = createState(samurai, kenji, 1);
  const link = createLoopback({ delay: 0, loss: 1 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a, maxPrediction: 8 });
  new RollbackSession({ local: 1, state: initial, transport: link.b });
  assert.equal(a.wantsInput, true);
  for (let i = 0; i < 40; i++) a.advance(0);
  assert.equal(a.frame, 8);
  // Stalled: the frame does not move, so a new sample would be thrown away.
  assert.equal(a.wantsInput, false);
  assert.ok(a.stalledFor > 20);
});

/** A header-only packet, as a hostile peer could hand-build one. */
function forgedPacket(frame: number, advantage: number): Uint8Array {
  const bytes = new Uint8Array(23);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, frame, true);
  view.setInt8(8, advantage);
  return bytes;
}

test('one forged frame number cannot switch the pacing off for the whole match', () => {
  const initial = createState(samurai, kenji, 6);
  const link = createLoopback({ delay: 2 });
  const a = new RollbackSession({ local: 0, state: initial, transport: link.a });
  const b = new RollbackSession({ local: 1, state: initial, transport: link.b });
  link.a.onmessage?.(forgedPacket(0xffff_ffff, 0));
  // B runs at half speed, so A is the one that has to give way now and then.
  for (let i = 0; i < 900; i++) {
    a.advance(0);
    if (i % 2 === 0) b.advance(0);
    link.tick();
  }
  assert.ok(a.stats.syncSkips > 0, 'A never sat a tick out for the slower peer');
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
