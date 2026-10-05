#!/usr/bin/env bash
# nginx setup: installs nginx + certbot, then installs generated per-domain
# configs from nginx/conf.d (produced by `npx tsx nginx-setup.ts`).
# Run as root on the VPS.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "run as root: sudo $0"; exit 1; fi

REPO="$(cd "$(dirname "$0")/../.." && pwd)"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update >/dev/null && apt-get install -y nginx certbot python3-certbot-nginx
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y nginx certbot python3-certbot-nginx
else
  echo "unsupported OS"; exit 1
fi

# Regenerate configs from .env + compose files if missing.
[ -f "$REPO/nginx/conf.d" ] || {
  echo "==> generating nginx configs (nginx-setup.ts)"
  (cd "$REPO" && npx tsx nginx-setup.ts)
}

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
for f in "$REPO"/nginx/conf.d/*.conf; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  cp "$f" "/etc/nginx/sites-available/${name%.conf}"
done

nginx -t && systemctl enable --now nginx
echo "nginx installed. Enable sites:"
echo "  for s in /etc/nginx/sites-available/*; do ln -sf \"\$s\" /etc/nginx/sites-enabled/; done"
echo "  nginx -t && systemctl reload nginx"
echo "  certbot --nginx -d <domain>   # for SSL certs"
