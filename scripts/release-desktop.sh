#!/usr/bin/env bash
set -e

VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9] ]]; then
  echo "Error: Version must start with a number (e.g., 0.1.0, not v0.1.0)"
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "Error: Working tree has uncommitted changes. Please commit or stash first."
  git diff --stat
  exit 1
fi

TAG="desktop-v${VERSION}"
CHANGELOG="$REPO_ROOT/packages/desktop/CHANGELOG.md"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists locally."
  exit 1
fi

if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists on origin."
  exit 1
fi

if ! grep -q "## \\[${VERSION}\\]" "$CHANGELOG" 2>/dev/null; then
  echo "Error: $CHANGELOG doesn't have an entry for version ${VERSION}"
  echo "Please add a '## [${VERSION}]' section before releasing."
  exit 1
fi

"$REPO_ROOT/scripts/set-desktop-version.sh" "$VERSION"

git add \
  "$REPO_ROOT/packages/desktop/package.json" \
  "$REPO_ROOT/packages/desktop/src-tauri/Cargo.toml" \
  "$REPO_ROOT/packages/desktop/src-tauri/Cargo.lock" \
  "$REPO_ROOT/packages/desktop/src-tauri/tauri.conf.json" \
  "$CHANGELOG"

if git diff --cached --quiet; then
  echo "No version metadata changes to commit."
else
  git commit -m "Release desktop v${VERSION}"
  git push origin HEAD
fi

git tag "$TAG"
git push origin "$TAG"

echo "Created and pushed tag $TAG"
