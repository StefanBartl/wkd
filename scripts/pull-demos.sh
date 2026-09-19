#!/usr/bin/env bash
# Fetch the current demo recordings (orphan branch demo-assets, written by
# .github/workflows/demos.yml) into public/demos/ for a local build.
# `git archive` leaves the index alone (a `--work-tree` checkout would stage
# the files as root-level paths).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/demos
git fetch --quiet --depth 1 origin demo-assets
git archive FETCH_HEAD | tar -x -C public/demos
echo "public/demos: $(ls public/demos | wc -l) files"
