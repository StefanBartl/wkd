#!/usr/bin/env node
// Builds wasm/fight-sim (Rust) and copies the result next to the TypeScript
// sim it mirrors. The .wasm is committed: the deploy workflow needs no Rust
// toolchain, and `pnpm test` fails if the committed binary and
// src/lib/fight-engine/sim.ts ever disagree.
//
// Needs: rustup target add wasm32-unknown-unknown
import { execFileSync } from 'node:child_process';
import { copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'wasm', 'fight-sim');
const out = join(root, 'src', 'lib', 'fight-engine', 'fight-sim.wasm');

execFileSync(
  'cargo',
  [
    'build',
    '--release',
    '--target',
    'wasm32-unknown-unknown',
    '--manifest-path',
    join(crate, 'Cargo.toml'),
  ],
  { stdio: 'inherit' },
);
copyFileSync(join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'fight_sim.wasm'), out);
console.log(`${out}: ${statSync(out).size} bytes`);
