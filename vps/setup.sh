#!/usr/bin/env bash
# One-shot VPS setup: docker + compose plugin + vaayu_db network + nginx/certbot.
# Run as root:  bash vps/setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "run as root: sudo bash $0"; exit 1; fi

echo "==> [1/4] install docker"
if command -v docker >/dev/null 2>&1; then
  echo "docker already installed"
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "==> [2/4] docker compose plugin"
docker compose version >/dev/null 2>&1 || {
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
}

echo "==> [3/4] shared docker network"
docker network create vaayu_db 2>/dev/null || echo "vaayu_db already exists"

echo "==> [4/4] nginx reverse proxy"
bash "$(dirname "$0")/nginx/setup-nginx.sh"

echo
echo "setup complete. Next:"
echo "  1. edit .env at the repo root (MONGO_ROOT_PASSWORD, DB_UI_PASSWORD, VA_DOMAIN)"
echo "  2. docker compose up -d --build    # start everything (joins vaayu_db)"
echo "  3. bash deploy.sh <pkg>            # build+run one app, or deploy.sh for all"
