#!/bin/bash
# Deploy vaayu-seo to the Contabo VPS — same pattern as vaayu-api-core:
# rsync the repo (minus build artifacts/secrets) → docker compose up --build
# on the VPS → nginx vhosts + Let's Encrypt SSL for both domains.
#
# Usage:  bash deploy.sh
# Prereqs: ssh host `contabo` configured (~/.ssh/config), DNS A-records:
#   seo.vaayulabs.com     → VPS IP
#   seo-api.vaayulabs.com → VPS IP
set -e

SSH_HOST="contabo"
REMOTE_DIR="/var/www/seo.vaayulabs.com"
WEB_DOMAIN="seo.vaayulabs.com"
API_DOMAIN="seo-api.vaayulabs.com"
WEB_PORT="3001"
# Container port (app listens here) vs host port (3400 taken by vaayu-api-core).
API_PORT="3400"
API_HOST_PORT="3401"

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

echo "▶ Checking Docker on ${SSH_HOST}..."
ssh "$SSH_HOST" 'bash -s' <<'REMOTE'
set -e
if command -v docker &>/dev/null; then echo "  Docker: $(docker --version)"; else
  curl -fsSL https://get.docker.com | sh && sudo systemctl enable docker && sudo systemctl start docker
fi
if ! docker ps &>/dev/null 2>&1; then sudo usermod -aG docker "$USER" && echo "  Re-login for docker group"; fi
if ! docker compose version &>/dev/null 2>&1; then sudo apt-get install -y -qq docker-compose-plugin; fi
REMOTE

echo "▶ Ensuring remote directory..."
ssh "$SSH_HOST" "mkdir -p ${REMOTE_DIR}"

echo "▶ Syncing files (services build on the VPS via their Dockerfiles)..."
rsync -avz \
  --exclude node_modules --exclude .git \
  --exclude '.DS_Store' --exclude '*.log' \
  --exclude 'dist' \
  --exclude '.env' --exclude '.env.prod' --exclude '.env.example' \
  ./ "${SSH_HOST}:${REMOTE_DIR}/"

echo "▶ Syncing nginx confs separately..."
rsync -avz nginx/ "${SSH_HOST}:${REMOTE_DIR}/nginx/"

echo "▶ Writing remote env files (secrets stay off git)..."
# API: port + optional free PageSpeed key (empty = keyless quota).
PSI_KEY=$(grep -E '^PAGESPEED_API_KEY=' packages/backend/seo-api/.env 2>/dev/null | tail -1 | cut -d= -f2- || echo '')
API_ENV="PORT=${API_PORT}
SERVICE_NAME=seo-api
DB_TYPE=none
PAGESPEED_API_KEY=${PSI_KEY}"
echo "$API_ENV" | ssh "$SSH_HOST" "cat > ${REMOTE_DIR}/packages/backend/seo-api/.env"

# Web: baked at build time. Relative /api rides the container nginx proxy
# (seo-api:3400); GA4 id is baked so prod traffic is tagged correctly.
GA4_ID=$(grep -E '^VITE_GA4_ID=' packages/web/seo/.env 2>/dev/null | tail -1 | cut -d= -f2- || echo '')
WEB_ENV="VITE_API_URL=/api
VITE_GA4_ID=${GA4_ID}"
echo "$WEB_ENV" | ssh "$SSH_HOST" "cat > ${REMOTE_DIR}/packages/web/seo/.env"

echo "▶ Building + starting services on VPS..."
ssh "$SSH_HOST" "cd ${REMOTE_DIR} && docker compose up -d --build"

echo "▶ Checking health..."
sleep 5
ssh "$SSH_HOST" "curl -sf http://localhost:${API_HOST_PORT}/health && echo ' -> seo-api healthy' || echo '  api health check failed'"

echo "▶ Setting up nginx + SSL..."
ssh "$SSH_HOST" "cd ${REMOTE_DIR} && sudo bash vps/setup-nginx.sh 2>&1" || {
  echo "  nginx setup script failed — sites may still work over HTTP."
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Site : https://${WEB_DOMAIN}"
echo "  API  : https://${API_DOMAIN}  (/health, /analyze, /pagespeed)"
echo "  Docs : https://${API_DOMAIN}/docs"
echo ""
echo "  Ensure DNS A-records for both domains → VPS IP first."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
