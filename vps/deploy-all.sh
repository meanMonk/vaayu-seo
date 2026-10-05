#!/usr/bin/env bash
# Deploy the whole platform: every package that has a compose.yaml.
# Usage: bash vps/deploy-all.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

git pull --ff-only 2>/dev/null || true

echo "==> backend services"
for d in packages/backend/*/; do
  [ -f "$d/compose.yaml" ] && docker compose -f "$d/compose.yaml" up -d --build
done

echo "==> web apps"
for d in packages/web/*/; do
  [ -f "$d/compose.yaml" ] && docker compose -f "$d/compose.yaml" up -d --build
done

docker system prune -f >/dev/null 2>&1 || true
echo "all up."
