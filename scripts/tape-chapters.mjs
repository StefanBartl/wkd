#!/usr/bin/env node
// Chapters of a VHS tape, computed from the tape itself: at which second of
// the recording each feature (each <C-t> title from $DEMO_TITLES, or a typed
// :Demo) begins. The Record workflow runs this per tape and publishes
// <tape>.chapters.json next to the video; the plugin page turns it into a
// list of jump marks under the player.
//
// The clock is VHS's own (v0.11, command.go): `Type` costs TypingSpeed per
// character, a key press (Enter, Escape, `Backspace 3`, …) one TypingSpeed per
// repeat, `Sleep` its duration, and nothing between `Hide` and `Show` reaches
// the video. Ctrl+/Alt+/Shift+ combinations cost nothing: VHS sends them
// without a delay. `@<speed>` on Type or on a key overrides TypingSpeed for
// that command, a `#` outside a string starts a comment, and a bare number is
// seconds. A title set while hidden starts its chapter at the next `Show`.
// Accurate to a few hundred milliseconds against the real recording, which
// is what a jump mark needs.
//
//   node scripts/tape-chapters.mjs demos/hover.tape > hover.chapters.json

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const tapePath = process.argv[2];
if (!tapePath) {
  console.error('usage: tape-chapters.mjs <tape>');
  process.exit(2);
}

/** @param {string} v a VHS duration; milliseconds */
const ms = (v) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(v.trim());
  if (!m) throw new Error(`bad duration ${v}`);
  return Number(m[1]) * (m[2] === 'ms' ? 1 : m[2] === 'm' ? 60000 : 1000);
};

/** The line up to a `#` that is not inside a string (VHS strings know no escapes). */
const stripComment = (line) => {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
};

/** The string literals of a line, in order ("…", '…' or `…`). */
const strings = (s) =>
  Array.from(s.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g), (m) => m[1] ?? m[2] ?? m[3]);

/** The tape's lines with `Source` expanded (settings live in _settings.tape). */
function lines(file) {
  const out = [];
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = stripComment(raw.trim());
    const src = /^Source\s+(\S+)/.exec(line);
    if (src) {
      out.push(...lines(resolve(dirname(file), '..', src[1])));
    } else {
      out.push(line);
    }
  }
  return out;
}

// Keys VHS delays by TypingSpeed (ExecuteKey), with an optional @speed and repeat count.
const KEY =
  /^(?:Enter|Escape|Tab|Backspace|Delete|Insert|Space|Up|Down|Left|Right|PageUp|PageDown|Home|End)(?:@(\S+))?(?:\s+(\d+))?(?:\s|$)/;

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
  const env = /^Env\s+DEMO_TITLES\s+(.*)$/.exec(line);
  const sleep = /^Sleep\s+(\S+)/.exec(line);
  const typed = /^Type(?:@(\S+))?\s+(.*)$/.exec(line);
  const key = KEY.exec(line);
  if (speed) {
    typing = ms(speed[1]);
  } else if (env) {
    titles = (strings(env[1])[0] ?? '').split('|').filter(Boolean);
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
    // VHS joins several string arguments with one space and types runes.
    const text = strings(typed[2]).join(' ');
    const demo = /^:Demo\s+(.+)$/.exec(text);
    if (demo && demo[1] !== 'off' && demo[1] !== 'end') startChapter(demo[1]);
    if (visible) clock += Array.from(text).length * (typed[1] ? ms(typed[1]) : typing);
  } else if (/^Ctrl\+[Tt]\b/.test(line)) {
    const title = titles[titleIndex++];
    if (title) startChapter(title);
  } else if (key) {
    if (visible) clock += (key[2] ? Number(key[2]) : 1) * (key[1] ? ms(key[1]) : typing);
  }
}

process.stdout.write(`${JSON.stringify(chapters)}\n`);
