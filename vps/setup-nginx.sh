#!/bin/bash
# Set up nginx vhosts + Let's Encrypt SSL for seo + seo-api domains.
# Runs on the VPS (Ubuntu) as root — same pattern as vaayu-api-core.
#
# Usage (from the deployed repo on the VPS):
#   sudo bash vps/setup-nginx.sh
set -euo pipefail

# domain:port pairs (VPS host ports; 3400 is taken by vaayu-api-core)
SITES="seo.vaayulabs.com:3001 seo-api.vaayulabs.com:3401"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBROOT="/var/www/certbot"

echo "▶ Setting up nginx + SSL for vaayu-seo"

if ! command -v nginx &>/dev/null; then
  echo "▶ Install nginx"
  apt-get update -qq && apt-get install -y nginx
fi

if ! command -v certbot &>/dev/null; then
  echo "▶ Install certbot"
  apt-get install -y certbot python3-certbot-nginx
fi

for pair in $SITES; do
  DOMAIN="${pair%%:*}"
  PORT="${pair##*:}"
  CONF_SRC="${ROOT}/nginx/${DOMAIN}.conf"
  CONF_DEST="/etc/nginx/sites-available/${DOMAIN}.conf"
  CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

  if [ ! -f "$CONF_SRC" ]; then echo "  !! missing $CONF_SRC — skipping $DOMAIN"; continue; fi

  echo "▶ nginx config: $CONF_DEST (-> 127.0.0.1:$PORT)"
  sed "s/{{PORT}}/${PORT}/g" "$CONF_SRC" > "$CONF_DEST"
  ln -sf "$CONF_DEST" "/etc/nginx/sites-enabled/${DOMAIN}.conf"

  if [ ! -f "$CERT_PATH" ]; then
    # First-time SSL: nginx -t would fail on the missing cert, so issue a
    # throwaway self-signed cert at the exact letsencrypt paths. This lets nginx
    # start and serve the port-80 ACME challenge, then certbot replaces it.
    echo "▶ Generate temporary self-signed cert for $DOMAIN"
    mkdir -p "/etc/letsencrypt/live/${DOMAIN}" "${WEBROOT}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" \
      -out "$CERT_PATH" \
      -subj "/CN=${DOMAIN}"

    echo "▶ Start nginx (temporary cert)"
    nginx -t
    systemctl reload nginx || nginx -s reload || true

    echo "▶ Obtain SSL cert (Let's Encrypt) for $DOMAIN"
    if certbot certonly --webroot -w "${WEBROOT}" -d "${DOMAIN}" \
      --expand --non-interactive --agree-tos --email hi@vaayulab.com; then
      systemctl reload nginx
      echo "✅ https://${DOMAIN} → 127.0.0.1:${PORT} (real SSL cert)"
    else
      echo "⚠ certbot failed for $DOMAIN — site is up with a TEMPORARY self-signed cert."
      echo "  Ensure DNS A-record ${DOMAIN} → VPS IP, then re-run: sudo bash vps/setup-nginx.sh"
    fi
  else
    echo "✔ SSL cert exists for $DOMAIN"
    nginx -t
    systemctl reload nginx
    echo "✅ https://${DOMAIN} → 127.0.0.1:${PORT}"
  fi
done
