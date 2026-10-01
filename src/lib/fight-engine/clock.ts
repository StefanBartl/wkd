// The fixed-timestep accumulator behind the match loop, kept free of the DOM
// so its arithmetic can be tested: however fast the display refreshes, the
// sim advances in whole 60 Hz steps.
import { SIM_HZ } from './sim.ts';

export const STEP_MS = 1000 / SIM_HZ;
// A frame this late (tab was throttled, debugger, GC pause) is not caught
// up step by step -- the match just loses that time.
export const MAX_FRAME_MS = 100;
const MAX_STEPS_PER_FRAME = 6;
// A step may run this much early. Frame times jitter around the step length
// (a 60 Hz display: 15-18 ms); without the slack a frame that is 0.2 ms short
// skips its step and the next one runs two. The time is carried in the
// accumulator, not thrown away, so the rate stays exactly 60 steps a second
// on a 57, 66 or 75 Hz display as well.
const STEP_SLACK_MS = 2;

export class StepClock {
  private acc = 0;

  /** Forget leftover time: the loop was stopped or has just started. */
  reset(): void {
    this.acc = 0;
  }

  /** Feed the duration of one rendered frame; returns how many sim steps are due. */
  frame(ms: number): number {
    this.acc += Math.min(ms, MAX_FRAME_MS);
    let steps = 0;
    while (this.acc >= STEP_MS - STEP_SLACK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= STEP_MS;
      steps++;
    }
    return steps;
  }
}
