#!/usr/bin/env bash
# Fetch the current demo recordings (orphan branch demo-assets, written by
# .github/workflows/demos.yml) into public/demos/ for a local build.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/demos
git fetch --quiet --depth 1 origin demo-assets
git --work-tree=public/demos checkout --quiet FETCH_HEAD -- .
git reset --quiet -- public/demos 2>/dev/null || true
echo "public/demos: $(ls public/demos | wc -l) files"
