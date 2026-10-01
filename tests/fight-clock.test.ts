import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_FRAME_MS, StepClock } from '../src/lib/fight-engine/clock.ts';

/** Steps per second the clock produces for a display that delivers frames `ms` apart. */
function rate(ms: number, seconds = 60): number {
  const clock = new StepClock();
  let steps = 0;
  const frames = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < frames; i++) steps += clock.frame(ms);
  return steps / (frames * (ms / 1000));
}

test('the sim runs at 60 steps a second on any steady display rate', () => {
  // 144, 120, 75, 66, 60, 57, 55 and a throttled 50 Hz.
  for (const ms of [6.94, 8.33, 13.33, 15, 16.67, 17.5, 18.18, 20]) {
    const stepsPerSecond = rate(ms);
    assert.ok(Math.abs(stepsPerSecond - 60) < 0.5, `${ms} ms frames gave ${stepsPerSecond}/s`);
  }
});

test('jitter around 60 Hz never skips a step only to run two the next frame', () => {
  const clock = new StepClock();
  // Jitter between 15 and 18.3 ms that averages exactly the step length (the
  // twelve frames add up to 200 ms); a display that is merely a bit slow
  // would need an occasional second step, which is right and not jitter.
  const frames = [16.1, 17.2, 15.4, 18.3, 16.9, 15.0, 17.9, 16.5, 16.67, 15.9, 17.4, 16.73];
  let maxInOneFrame = 0;
  let zeroFrames = 0;
  for (let round = 0; round < 50; round++) {
    for (const ms of frames) {
      const steps = clock.frame(ms);
      maxInOneFrame = Math.max(maxInOneFrame, steps);
      if (steps === 0) zeroFrames++;
    }
  }
  assert.equal(maxInOneFrame, 1);
  assert.equal(zeroFrames, 0);
});

test('a long stall is not caught up: the match loses that time', () => {
  const clock = new StepClock();
  const steps = clock.frame(5000);
  assert.ok(steps <= 6, `${steps} steps in one frame`);
  assert.ok(steps <= Math.ceil(MAX_FRAME_MS / (1000 / 60)));
  // ...and the backlog is not paid back over the following frames.
  let later = 0;
  for (let i = 0; i < 10; i++) later += clock.frame(16.67);
  assert.ok(later <= 10, `${later} steps in the next 10 frames`);
});

test('reset forgets leftover time', () => {
  const clock = new StepClock();
  clock.frame(10);
  clock.reset();
  assert.equal(clock.frame(10), 0);
});
