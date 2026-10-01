// Gamepad as one more input source: a controller snapshot in, the same
// IN_* bitmask out that keyboard and touch produce. Kept free of
// `navigator` so it can be tested with plain objects.
import { IN_ATTACK1, IN_ATTACK2, IN_JUMP, IN_LEFT, IN_RIGHT } from './sim.ts';

/** The subset of the Gamepad interface this needs. */
export interface PadSnapshot {
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

// Indices of the W3C "standard" layout (Xbox naming).
const BTN_A = 0;
const BTN_B = 1;
const BTN_X = 2;
const BTN_Y = 3;
const DPAD_UP = 12;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const AXIS_X = 0;
const AXIS_Y = 1;
// Worn sticks rest well off-centre; walking needs a clear push, a jump an
// even clearer one so a sloppy sideways push doesn't hop.
const WALK_DEADZONE = 0.5;
const JUMP_DEADZONE = 0.7;

export function padInput(pad: PadSnapshot | null | undefined): number {
  // A non-standard mapping puts buttons anywhere; guessing would map a
  // trigger to "jump" on one pad and "left" on the next.
  if (pad?.mapping !== 'standard') return 0;
  const down = (i: number): boolean => pad.buttons[i]?.pressed === true;
  const x = pad.axes[AXIS_X] ?? 0;
  const y = pad.axes[AXIS_Y] ?? 0;
  let input = 0;
  if (down(DPAD_LEFT) || x < -WALK_DEADZONE) input |= IN_LEFT;
  if (down(DPAD_RIGHT) || x > WALK_DEADZONE) input |= IN_RIGHT;
  if (down(BTN_A) || down(DPAD_UP) || y < -JUMP_DEADZONE) input |= IN_JUMP;
  if (down(BTN_X)) input |= IN_ATTACK1;
  if (down(BTN_B) || down(BTN_Y)) input |= IN_ATTACK2;
  return input;
}

/** Combined input of every connected standard-layout controller. */
export function pollGamepads(): number {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return 0;
  let input = 0;
  for (const pad of navigator.getGamepads()) input |= padInput(pad);
  return input;
}
