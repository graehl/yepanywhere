#!/usr/bin/env bash
#
# Rebuild and redeploy the YepAnywhere staging server.
#
# scripts/staging.js serves *pre-built* static assets, so this script
# regenerates them and restarts the service. It stops the service first so the
# builds don't compete with a running watcher for RAM and don't race on the
# dist-remote output dir — a simultaneous build + dev-watch is what historically
# swap-thrashed remy into unresponsiveness.
#
# Builds run sequentially with a bounded Node heap, so a runaway build fails
# cleanly (JS heap OOM) instead of dragging the whole box into swap.
#
# Usage:  scripts/deploy-staging.sh
#   STAGING_SERVICE=...  override the systemd --user unit name (default: yepanywhere-staging)
#   NODE_BUILD_HEAP=...  override the max-old-space-size cap in MB (default: 3072)
#
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="${STAGING_SERVICE:-yepanywhere-staging}"
HEAP="${NODE_BUILD_HEAP:-3072}"
export NODE_OPTIONS="--max-old-space-size=${HEAP}"

echo "[deploy-staging] Stopping ${SERVICE} (frees RAM, avoids dist-remote race)..."
systemctl --user stop "${SERVICE}" 2>/dev/null || true

echo "[deploy-staging] Building remote client -> packages/client/dist-remote ..."
# NOTE: --base /remote/ is required (vite.config.remote.ts does not set base);
# the client is served under /remote/ by staging.js.
pnpm --filter client exec vite build \
  --config vite.config.remote.ts \
  --base /remote/

echo "[deploy-staging] Building marketing site -> site/dist ..."
( cd site && pnpm exec astro build )

echo "[deploy-staging] Starting ${SERVICE} ..."
systemctl --user start "${SERVICE}"

echo "[deploy-staging] Status:"
systemctl --user --no-pager --lines=0 status "${SERVICE}" || true
echo "[deploy-staging] Done."
