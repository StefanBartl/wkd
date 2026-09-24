#!/usr/bin/env node
// Idempotent, one-shot editor: inserts a "part of wkd" badge into the badge
// paragraph of every plugin's own README, plus a one-line blockquote right
// after it, before the pitch paragraph. Run once per registry addition, not
// as part of any build -- it edits the *sibling* checkouts under
// PLUGINS_DIR, never anything inside this repo.
//
//   node scripts/add-wkd-badge.mjs             # dry run, prints what it would do
//   node scripts/add-wkd-badge.mjs --write     # actually edits the READMEs
//
// Insertion point mirrors the family's README shape (banner code fence,
// then one shields.io badge per line, then a blank line, then the pitch
// paragraph) rather than "before ## Contents": not every README still has
// that heading after the Fassung-3 migration, but every one seen so far has
// the badge-then-blank-then-pitch shape.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import registry from '../src/data/registry.json' with { type: 'json' };

const PLUGINS_DIR = resolve(process.env.PLUGINS_DIR ?? '..');
const WRITE = process.argv.includes('--write');
const SITE = 'https://stefanbartl.github.io/wkd';

const BADGE_MARK = 'wkd-family'; // idempotency check: skip if already present

function badgeLine(slug) {
  return `[![wkd](https://img.shields.io/badge/wkd-family-c6ff3d)](${SITE}/p/${slug}/)`;
}
function quoteLine(slug) {
  return `> Part of the [wkd](${SITE}/) family — see this plugin's [page](${SITE}/p/${slug}/) on the site.`;
}

function isBadgeLine(line) {
  return /^\[!\[|^!\[/.test(line.trim());
}

/** @returns {{lines: string[]} | {skip: string}} */
function edit(readme, slug) {
  if (readme.includes(BADGE_MARK)) return { skip: 'already has the wkd badge' };

  const lines = readme.split(/\r?\n/);
  const bannerOpen = lines.findIndex((l, i) => i < 40 && /^```/.test(l));
  if (bannerOpen < 0) return { skip: 'no fenced banner in the first 40 lines' };
  const bannerClose = lines.findIndex((l, i) => i > bannerOpen && /^```/.test(l));
  if (bannerClose < 0) return { skip: 'unterminated banner fence' };

  let i = bannerClose + 1;
  // Some READMEs have an optional "> Sister plugin: ..." / "> Pairs well
  // with ..." blockquote between the banner and the badges -- skip past it
  // too, not just blank lines.
  while (i < lines.length && (lines[i].trim() === '' || lines[i].trim().startsWith('>'))) i++;
  const badgeStart = i;
  while (i < lines.length && isBadgeLine(lines[i])) i++;
  const badgeEnd = i - 1; // last badge line, inclusive
  if (badgeEnd < badgeStart) return { skip: 'no shields.io badge line found after the banner' };

  const next = [...lines];
  next.splice(badgeEnd + 1, 0, badgeLine(slug), '', quoteLine(slug));
  return { lines: next };
}

const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const results = [];
for (const entry of registry.plugins) {
  if (entry.kind === 'desktop') continue; // scope: Neovim plugins only, see T1
  const slug = entry.name.replace(/\.nvim$/, '');
  if (only && slug !== only) continue;
  const readmePath = resolve(PLUGINS_DIR, entry.name, 'README.md');
  if (!existsSync(readmePath)) {
    results.push({ name: entry.name, status: 'missing README.md' });
    continue;
  }
  const readme = readFileSync(readmePath, 'utf8');
  const outcome = edit(readme, slug);
  if ('skip' in outcome) {
    results.push({ name: entry.name, status: `skipped: ${outcome.skip}` });
    continue;
  }
  if (WRITE) writeFileSync(readmePath, outcome.lines.join('\n'));
  results.push({ name: entry.name, status: WRITE ? 'written' : 'would write' });
}

for (const r of results) console.log(`${r.status.padEnd(28)} ${r.name}`);
const summary = results.reduce((acc, r) => {
  const key = r.status.startsWith('skipped') ? 'skipped' : r.status;
  acc[key] = (acc[key] ?? 0) + 1;
  return acc;
}, {});
console.log(`\n${JSON.stringify(summary)}`);
