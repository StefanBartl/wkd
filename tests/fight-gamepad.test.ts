import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type PadSnapshot, padInput } from '../src/lib/fight-engine/gamepad.ts';
import { IN_ATTACK1, IN_ATTACK2, IN_JUMP, IN_LEFT, IN_RIGHT } from '../src/lib/fight-engine/sim.ts';

function pad(pressed: number[], axes: number[] = [0, 0], mapping = 'standard'): PadSnapshot {
  return {
    mapping,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  };
}

test('no pad, or an unknown layout, contributes nothing', () => {
  assert.equal(padInput(null), 0);
  assert.equal(padInput(pad([0, 2, 14], [1, -1], '')), 0);
});

test('d-pad and face buttons map to the fight actions', () => {
  assert.equal(padInput(pad([14])), IN_LEFT);
  assert.equal(padInput(pad([15])), IN_RIGHT);
  assert.equal(padInput(pad([0])), IN_JUMP);
  assert.equal(padInput(pad([12])), IN_JUMP);
  assert.equal(padInput(pad([2])), IN_ATTACK1);
  assert.equal(padInput(pad([1])), IN_ATTACK2);
  assert.equal(padInput(pad([3])), IN_ATTACK2);
  assert.equal(padInput(pad([15, 0, 2])), IN_RIGHT | IN_JUMP | IN_ATTACK1);
});

test('the stick needs a clear push past its deadzone', () => {
  assert.equal(padInput(pad([], [0.3, -0.3])), 0, 'resting drift is ignored');
  assert.equal(padInput(pad([], [-0.8, 0])), IN_LEFT);
  assert.equal(padInput(pad([], [0.8, 0])), IN_RIGHT);
  assert.equal(padInput(pad([], [0.8, -0.6])), IN_RIGHT, 'a sloppy diagonal walks, no hop');
  assert.equal(padInput(pad([], [0, -0.9])), IN_JUMP);
});

test('a pad reporting fewer buttons or axes than the layout is tolerated', () => {
  assert.equal(padInput({ mapping: 'standard', axes: [], buttons: [{ pressed: true }] }), IN_JUMP);
});
