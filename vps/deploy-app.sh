#!/usr/bin/env bash
# Deploy ONE app/service on the VPS (from a git checkout).
# Usage: bash vps/deploy-app.sh <path-to-package> [extra compose args...]
#   bash vps/deploy-app.sh packages/web/app1
#   bash vps/deploy-app.sh packages/backend/api1
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${1:?usage: deploy-app.sh <path-to-package>}"
shift

cd "$REPO"

if [ ! -f "$PKG/compose.yaml" ]; then
  echo "no compose.yaml in $PKG — nothing to deploy"; exit 1
fi
if [ ! -f "$PKG/.env" ]; then
  echo "missing $PKG/.env — copy .env.example and edit first"; exit 1
fi

echo "==> pulling repo"
git pull --ff-only 2>/dev/null || echo "(not a git checkout — skipping pull)"

echo "==> building & starting $PKG"
docker compose -f "$PKG/compose.yaml" up -d --build "$@"

echo "==> pruning dangling images"
docker system prune -f >/dev/null 2>&1 || true

PORT="$(grep -Eo '[0-9]+:[0-9]+' "$PKG/compose.yaml" 2>/dev/null | head -1 | cut -d: -f1 || true)"
if [ -n "${PORT:-}" ]; then
  curl -sf "http://localhost:${PORT}/health" && echo " -> healthy on :${PORT}" || echo "health check failed on :${PORT}"
fi

echo "done."
