// Runs in the AudioWorkletGlobalScope, on the audio rendering thread: a
// tiny polyphonic synth plus the music sequencer. Timing is counted in
// samples here, so the arpeggio can't drift or stutter when the main thread
// is busy -- the reason this exists instead of setInterval + OscillatorNode.
// Plain JavaScript on purpose: the file is shipped as-is (imported with
// ?url) and loaded via audioWorklet.addModule(), nothing bundles it.
//
// Still placeholder sound, not produced audio: naive (aliasing) waveforms
// and a fixed eight-note loop.

const NOTES = [110, 130.81, 146.83, 110, 164.81, 146.83, 130.81, 98];
const STEP_SECONDS = 0.23;
const MUSIC_NOTE = { wave: 'triangle', f0: 0, at: 0, dur: 0.2, attack: 0.02, peak: 0.05 };

const SFX = {
  hit: [{ wave: 'saw', f0: 180, f1: 60, sweep: 0.1, at: 0, dur: 0.12, attack: 0, peak: 0.18 }],
  stinger: [
    { wave: 'square', f0: 220, at: 0, dur: 0.16, attack: 0.02, peak: 0.22 },
    { wave: 'square', f0: 146, at: 0.1, dur: 0.32, attack: 0.02, peak: 0.22 },
  ],
  blip: [
    { wave: 'sine', f0: 880, f1: 1320, sweep: 0.06, at: 0, dur: 0.08, attack: 0.015, peak: 0.12 },
  ],
};

// e^-6.9 ~ 0.001: the envelope has faded to silence when the note ends.
const DECAY = 6.9;

function oscillator(wave, phase) {
  switch (wave) {
    case 'square':
      return phase < 0.5 ? 1 : -1;
    case 'saw':
      return 2 * phase - 1;
    case 'triangle':
      return 1 - 4 * Math.abs(phase - 0.5);
    default:
      return Math.sin(2 * Math.PI * phase);
  }
}

class FightAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.musicOn = false;
    this.noteIndex = 0;
    this.samplesUntilNote = 0;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'music') {
        this.musicOn = msg.on === true;
        this.noteIndex = 0;
        this.samplesUntilNote = 0;
      } else if (msg.type === 'sfx') {
        for (const def of SFX[msg.name] ?? []) this.spawn(def, def.f0);
      }
    };
  }

  spawn(def, freq) {
    this.voices.push({
      wave: def.wave,
      f0: freq,
      ratio: def.f1 ? def.f1 / freq : 1,
      sweep: Math.max(1, Math.round((def.sweep ?? 0) * sampleRate)),
      delay: Math.round(def.at * sampleRate),
      age: 0,
      dur: Math.round(def.dur * sampleRate),
      attack: Math.round(def.attack * sampleRate),
      peak: def.peak,
      phase: 0,
    });
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    if (!left) return true;
    for (let i = 0; i < left.length; i++) {
      if (this.musicOn) {
        if (this.samplesUntilNote <= 0) {
          this.spawn(MUSIC_NOTE, NOTES[this.noteIndex % NOTES.length]);
          this.noteIndex++;
          this.samplesUntilNote += Math.round(STEP_SECONDS * sampleRate);
        }
        this.samplesUntilNote--;
      }

      let sample = 0;
      for (let v = this.voices.length - 1; v >= 0; v--) {
        const voice = this.voices[v];
        if (voice.delay > 0) {
          voice.delay--;
          continue;
        }
        const freq =
          voice.ratio === 1
            ? voice.f0
            : voice.f0 * voice.ratio ** Math.min(1, voice.age / voice.sweep);
        voice.phase += freq / sampleRate;
        voice.phase -= Math.floor(voice.phase);
        const env =
          voice.age < voice.attack
            ? voice.age / voice.attack
            : Math.exp((-DECAY * (voice.age - voice.attack)) / (voice.dur - voice.attack));
        sample += oscillator(voice.wave, voice.phase) * env * voice.peak;
        if (++voice.age >= voice.dur) this.voices.splice(v, 1);
      }
      left[i] = sample;
    }
    for (let c = 1; c < out.length; c++) out[c].set(left);
    return true;
  }
}

registerProcessor('fight-audio', FightAudio);
