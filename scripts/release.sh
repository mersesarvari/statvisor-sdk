#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────
#  release.sh — build, version bump, and publish
#  Usage: ./scripts/release.sh [patch|minor|major]
#         defaults to "patch"
# ─────────────────────────────────────────────

BUMP=${1:-patch}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PKG_DIR"

# ── 1. Validate bump type ──────────────────────
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Error: bump type must be patch, minor, or major (got: '$BUMP')"
  exit 1
fi

# ── 2. Check npm login ────────────────────────
echo "Checking npm login..."
NPM_USER=$(npm whoami 2>/dev/null || true)
if [[ -z "$NPM_USER" ]]; then
  echo "Error: you are not logged in to npm. Run: npm login"
  exit 1
fi
echo "Logged in as: $NPM_USER"

# ── 3. Clean previous build ───────────────────
echo "Cleaning dist/..."
rm -rf dist

# ── 4. Install dependencies ───────────────────
echo "Installing dependencies..."
npm install --silent

# ── 5. Build ──────────────────────────────────
echo "Building..."
npm run build

# Verify both CJS and ESM outputs were created
if [[ ! -f "dist/index.js" || ! -f "dist/index.mjs" ]]; then
  echo "Error: build failed — expected dist/index.js and dist/index.mjs"
  exit 1
fi

# ── 6. Bump version ───────────────────────────
echo "Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version --silent
NEW_VERSION="v$(node -p "require('./package.json').version")"
echo "New version: $NEW_VERSION"

# ── 7. Git commit + tag ───────────────────────
if git rev-parse --git-dir > /dev/null 2>&1; then
  git add package.json
  git commit -m "chore(sdk): release $NEW_VERSION"
  git tag "$NEW_VERSION"

  echo "Git commit and tag created: $NEW_VERSION"
fi

# ── 8. Publish ────────────────────────────────
echo "Publishing to npm..."
npm publish --access public

echo ""
echo "Published $NEW_VERSION successfully!"
echo "Install with: npm install @statvisor/sdk"
