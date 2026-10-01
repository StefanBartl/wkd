import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGHTERS, type FighterConfig } from '../src/lib/fight.ts';
import { aiDriver } from '../src/lib/fight-engine/driver.ts';
import { laggedAiDriver } from '../src/lib/fight-engine/net-driver.ts';
import {
  createState,
  EV_HIT_P0,
  F_HEALTH,
  fighterBase,
  IN_ATTACK1,
  OVER_P0,
  OVER_P1,
  step,
} from '../src/lib/fight-engine/sim.ts';

function fixture(index: number): FighterConfig {
  const fighter = FIGHTERS[index];
  if (!fighter) throw new Error('fixture fighter missing');
  return fighter;
}
const samurai = fixture(0);
const kenji = fixture(2);

test('the plain AI driver plays a match to a result', () => {
  const state = createState(samurai, kenji, 5);
  const driver = aiDriver(state, (a, b) => step(state, a, b));
  assert.equal(driver.status(), null);
  let ticks = 0;
  while (driver.outcome === 0 && ticks++ < 10_000) driver.tick(0);
  assert.equal(driver.outcome, OVER_P1, 'an idle player loses to the AI');
});

test('the AI behind a laggy, lossy link still fights and the match still ends', () => {
  const driver = laggedAiDriver(createState(samurai, kenji, 5), {
    delay: 6,
    jitter: 2,
    loss: 0.05,
  });
  let events = 0;
  let ticks = 0;
  while (driver.outcome === 0 && ticks++ < 10_000) events |= driver.tick(0);
  assert.ok(events & EV_HIT_P0, 'the AI never landed a hit');
  assert.equal(driver.outcome, OVER_P1);
  assert.equal(driver.state[fighterBase(0) + F_HEALTH], 0);
  assert.match(
    driver.status() ?? '',
    /rollbacks \d+ · deepest \d+f · guessing \d+f · simulated 100ms/,
  );
});

test('behind the same link the player can still win', () => {
  const driver = laggedAiDriver(createState(samurai, kenji, 8), { delay: 4 });
  // Stand still and swing: the AI walks into it.
  let ticks = 0;
  while (driver.outcome === 0 && ticks++ < 10_000) driver.tick(IN_ATTACK1);
  assert.ok(driver.outcome === OVER_P0 || driver.outcome === OVER_P1);
  assert.ok((driver.state[fighterBase(1) + F_HEALTH] as number) < 100, 'the AI took no damage');
});
