// Fight audio, main-thread side. No sound assets exist in the source
// project (it never had any either -- see its own ToDo.md): everything is
// synthesised, a placeholder Stefan can replace with real audio later.
//
// The synth itself runs in an AudioWorklet (audio.worklet.js) so the music
// loop is timed in samples on the audio thread. Until that module has
// loaded -- or where AudioWorklet is missing or fails to load -- the same
// sounds come from plain OscillatorNodes scheduled from here.
//
// no-inline matters: the module is small enough that Vite would otherwise
// hand back a data: URL, which the site's CSP (script-src 'self') refuses
// -- only in the deployed build, the dev server enforces no CSP.
import workletUrl from './audio.worklet.js?url&no-inline';

export type Sfx = 'hit' | 'stinger' | 'blip';

let audioCtx: AudioContext | null = null;
let worklet: AudioWorkletNode | null = null;
let workletRequested = false;

function loadWorklet(ctx: AudioContext): void {
  if (workletRequested || !ctx.audioWorklet) return;
  workletRequested = true;
  ctx.audioWorklet
    .addModule(workletUrl)
    .then(() => {
      const node = new AudioWorkletNode(ctx, 'fight-audio', {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      node.connect(ctx.destination);
      worklet = node;
      // Music that started on the fallback while the module was loading
      // moves over, so there is never a second loop on top of the first.
      if (music.playing) {
        music.stopFallback();
        node.port.postMessage({ type: 'music', on: true });
      }
    })
    .catch(() => {
      // The oscillator fallback below keeps working.
    });
}

/** Call from a user gesture: browsers keep a context suspended until one. */
function getAudioCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioCtx) {
    // Before the first click or key press the browser keeps a new context
    // suspended, and whatever is played meanwhile (the hover blip) would be
    // heard later, all at once, on top of the first real sound.
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === false) {
      return null;
    }
    audioCtx = new AudioContext();
  }
  // Safari parks the context as 'interrupted' (a call, the lock screen) and
  // does not bring it back by itself.
  if (audioCtx.state === 'suspended' || (audioCtx.state as string) === 'interrupted') {
    void audioCtx.resume();
  }
  loadWorklet(audioCtx);
  return audioCtx;
}

interface Tone {
  readonly type: OscillatorType;
  readonly f0: number;
  readonly f1?: number;
  readonly sweep?: number;
  readonly at: number;
  readonly dur: number;
  readonly attack: number;
  readonly peak: number;
}

// Mirrors the SFX table in audio.worklet.js.
const FALLBACK_SFX: Readonly<Record<Sfx, readonly Tone[]>> = {
  hit: [{ type: 'sawtooth', f0: 180, f1: 60, sweep: 0.1, at: 0, dur: 0.12, attack: 0, peak: 0.18 }],
  stinger: [
    { type: 'square', f0: 220, at: 0, dur: 0.16, attack: 0.02, peak: 0.22 },
    { type: 'square', f0: 146, at: 0.1, dur: 0.32, attack: 0.02, peak: 0.22 },
  ],
  blip: [
    { type: 'sine', f0: 880, f1: 1320, sweep: 0.06, at: 0, dur: 0.08, attack: 0.015, peak: 0.12 },
  ],
};

function playTone(ctx: AudioContext, tone: Tone, destination: AudioNode): void {
  const start = ctx.currentTime + tone.at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.f0, start);
  if (tone.f1 && tone.sweep)
    osc.frequency.exponentialRampToValueAtTime(tone.f1, start + tone.sweep);
  if (tone.attack > 0) {
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.peak, start + tone.attack);
  } else {
    gain.gain.setValueAtTime(tone.peak, start);
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + tone.dur + 0.05);
}

/**
 * Like every Web Audio sound this can be a silent no-op before the page has
 * seen a user gesture -- browser autoplay policy, not a bug here.
 */
export function playSfx(name: Sfx): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (worklet) {
    worklet.port.postMessage({ type: 'sfx', name });
    return;
  }
  for (const tone of FALLBACK_SFX[name]) playTone(ctx, tone, ctx.destination);
}

const FALLBACK_NOTES = [110, 130.81, 146.83, 110, 164.81, 146.83, 130.81, 98];
const FALLBACK_STEP_MS = 230;

class Music {
  playing = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private index = 0;

  start(): void {
    const ctx = getAudioCtx();
    if (!ctx) return;
    this.stop();
    this.playing = true;
    if (worklet) {
      worklet.port.postMessage({ type: 'music', on: true });
      return;
    }
    this.index = 0;
    const note = (): void => {
      const f0 = FALLBACK_NOTES[this.index++ % FALLBACK_NOTES.length] ?? 110;
      playTone(
        ctx,
        { type: 'triangle', f0, at: 0, dur: 0.2, attack: 0.02, peak: 0.05 },
        ctx.destination,
      );
    };
    this.timer = setInterval(note, FALLBACK_STEP_MS);
    note();
  }

  stopFallback(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  stop(): void {
    this.playing = false;
    this.stopFallback();
    worklet?.port.postMessage({ type: 'music', on: false });
  }
}

export const music = new Music();
