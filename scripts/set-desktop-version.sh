#!/usr/bin/env bash
#
# Set the Yep Anywhere desktop app version across all release metadata.
# Used for test releases and by scripts/release-desktop.sh.
#
# Usage: ./scripts/set-desktop-version.sh <version>
#
# Updates:
#   - packages/desktop/package.json
#   - packages/desktop/src-tauri/Cargo.toml
#   - packages/desktop/src-tauri/tauri.conf.json
#   - packages/desktop/src-tauri/Cargo.lock (via cargo check)
#
set -e

VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo ""
  echo "Examples:"
  echo "  $0 0.0.1"
  echo "  $0 0.1.0"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9] ]]; then
  echo "Error: Version must start with a number (e.g., 0.1.0, not v0.1.0)"
  exit 1
fi

PKG_JSON="$REPO_ROOT/packages/desktop/package.json"
CARGO_TOML="$REPO_ROOT/packages/desktop/src-tauri/Cargo.toml"
TAURI_CONF="$REPO_ROOT/packages/desktop/src-tauri/tauri.conf.json"
TAURI_DIR="$REPO_ROOT/packages/desktop/src-tauri"

CURRENT=$(grep '"version":' "$TAURI_CONF" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

if [ "$CURRENT" = "$VERSION" ]; then
  echo "Already at version $VERSION"
  exit 0
fi

echo "Updating desktop app version: $CURRENT -> $VERSION"

if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$PKG_JSON"
  sed -i '' "s/^version = \".*\"/version = \"${VERSION}\"/" "$CARGO_TOML"
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$TAURI_CONF"
else
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$PKG_JSON"
  sed -i "s/^version = \".*\"/version = \"${VERSION}\"/" "$CARGO_TOML"
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$TAURI_CONF"
fi

# Update Cargo.lock's local package version. Ignore build failures here so the
# release script can still surface them in CI; the lockfile update itself is the
# important side effect.
(cd "$TAURI_DIR" && cargo check --quiet 2>/dev/null) || true

echo "Updated:"
echo "  $PKG_JSON"
echo "  $CARGO_TOML"
echo "  $TAURI_CONF"
echo "  packages/desktop/src-tauri/Cargo.lock"
