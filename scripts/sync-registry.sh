#!/usr/bin/env bash
#
# sync-registry.sh — pull the canonical HWES v1 recipe + primitive
# vocabulary from production into the engine's build-time snapshot.
#
# WHY THIS EXISTS
# ---------------
# The engine reads `player_directives` from a COMPILED-IN registry, never
# from the live network. That preserves determinism (every player with the
# same snapshot renders the same recipe identically) and avoids a startup
# RTT hit. The trade-off: the snapshot needs to be re-fetched and
# committed any time the platform adds a new built-in recipe or directive
# primitive.
#
# A CI test (test/ci/registry-sync.test.js) compares this snapshot to the
# live endpoint and fails if they drift — your cue to re-run this script
# and commit the new snapshot.
#
# USAGE
# -----
#   scripts/sync-registry.sh                    # pull from production
#   HWES_BASE=http://localhost:3000 scripts/sync-registry.sh  # local dev
#
# Exits non-zero on any fetch failure.

set -euo pipefail

BASE="${HWES_BASE:-https://harmonicwave.ai}"
DEST="src/registry-snapshot"

mkdir -p "$DEST"

echo "→ Fetching $BASE/hwes/v1/recipes.json"
curl -fsSL "$BASE/hwes/v1/recipes.json"    > "$DEST/recipes.json"

echo "→ Fetching $BASE/hwes/v1/primitives.json"
curl -fsSL "$BASE/hwes/v1/primitives.json" > "$DEST/primitives.json"

# Quick sanity check — both files should be valid JSON declaring version "1".
# Uses grep instead of a JS runtime so the script works on any *nix environment
# without depending on bun/node/python being on PATH.
if ! grep -q '"version":"1"' "$DEST/recipes.json"; then
  echo "  ✗ recipes.json missing \"version\":\"1\" — fetch may have failed"
  exit 1
fi
if ! grep -q '"version":"1"' "$DEST/primitives.json"; then
  echo "  ✗ primitives.json missing \"version\":\"1\" — fetch may have failed"
  exit 1
fi
# Spot-check a couple of known-good slugs / primitives so we fail loudly
# if the platform regresses the registry shape.
grep -q '"story_then_play"'        "$DEST/recipes.json"    || { echo "  ✗ recipes.json missing story_then_play"; exit 1; }
grep -q '"cinematic_fullscreen"'   "$DEST/recipes.json"    || { echo "  ✗ recipes.json missing cinematic_fullscreen"; exit 1; }
grep -q '"prominence"'             "$DEST/primitives.json" || { echo "  ✗ primitives.json missing prominence"; exit 1; }
grep -q '"narration_position"'     "$DEST/primitives.json" || { echo "  ✗ primitives.json missing narration_position"; exit 1; }
echo "  ✓ recipes.json + primitives.json look valid"

echo "✓ Snapshot updated. Commit src/registry-snapshot/ to lock the engine to this vocabulary."
