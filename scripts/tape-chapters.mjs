#!/usr/bin/env node
// Chapters of a VHS tape, computed from the tape itself: at which second of
// the recording each feature (each <C-t> title from $DEMO_TITLES, or a typed
// :Demo) begins. The Record workflow runs this per tape and publishes
// <tape>.chapters.json next to the video; the plugin page turns it into a
// list of jump marks under the player.
//
// The clock is VHS's own: `Type` costs TypingSpeed per character, a key press
// (Enter, Escape, Ctrl+…) one TypingSpeed, `Sleep` its duration, and nothing
// between `Hide` and `Show` reaches the video. A title set while hidden
// starts its chapter at the next `Show`. Accurate to a few hundred
// milliseconds against the real recording, which is what a jump mark needs.
//
//   node scripts/tape-chapters.mjs demos/hover.tape > hover.chapters.json

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const tapePath = process.argv[2];
if (!tapePath) {
  console.error('usage: tape-chapters.mjs <tape>');
  process.exit(2);
}

/** @param {string} v */
const ms = (v) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(v.trim());
  if (!m) throw new Error(`bad duration ${v}`);
  return Number(m[1]) * (m[2] === 'ms' ? 1 : 1000);
};

/** The tape's lines with `Source` expanded (settings live in _settings.tape). */
function lines(file) {
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    const src = /^Source\s+(\S+)/.exec(line);
    if (src) {
      out.push(...lines(resolve(dirname(file), '..', src[1])));
    } else {
      out.push(line);
    }
  }
  return out;
}

let typing = 50; // VHS default TypingSpeed
let titles = [];
let titleIndex = 0;
let visible = false;
let clock = 0; // ms of recorded video so far
let pending = null; // a title set while hidden, waiting for Show
const chapters = [];

const startChapter = (title) => {
  if (visible) chapters.push({ t: Math.round(clock / 100) / 10, title });
  else pending = title;
};

for (const line of lines(tapePath)) {
  const speed = /^Set\s+TypingSpeed\s+(\S+)/.exec(line);
  const env = /^Env\s+DEMO_TITLES\s+"(.*)"\s*$/.exec(line);
  const sleep = /^Sleep\s+(\S+)/.exec(line);
  const typed = /^Type\s+(?:"(.*)"|`(.*)`)\s*$/.exec(line);
  if (speed) {
    typing = ms(speed[1]);
  } else if (env) {
    titles = env[1].split('|').filter(Boolean);
  } else if (/^Hide\b/.test(line)) {
    visible = false;
  } else if (/^Show\b/.test(line)) {
    visible = true;
    if (pending !== null) {
      chapters.push({ t: Math.round(clock / 100) / 10, title: pending });
      pending = null;
    }
  } else if (sleep) {
    if (visible) clock += ms(sleep[1]);
  } else if (typed) {
    const text = typed[1] ?? typed[2] ?? '';
    const demo = /^:Demo\s+(.+)$/.exec(text);
    if (demo && demo[1] !== 'off' && demo[1] !== 'end') startChapter(demo[1]);
    if (visible) clock += text.length * typing;
  } else if (/^Ctrl\+T\b/.test(line)) {
    const title = titles[titleIndex++];
    if (title) startChapter(title);
    if (visible) clock += typing;
  } else if (
    /^(Enter|Escape|Tab|Backspace|Space|Up|Down|Left|Right|Ctrl\+|Alt\+|Shift\+)/.test(line)
  ) {
    if (visible) clock += typing;
  }
}

process.stdout.write(`${JSON.stringify(chapters)}\n`);
