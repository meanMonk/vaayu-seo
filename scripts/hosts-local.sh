#!/usr/bin/env bash
# One-time local setup so the SAME DB URIs work for brew (local) AND docker.
# Adds aliases to /etc/hosts so `mongo` / `postgres` resolve to loopback.
# Usage:  sudo bash scripts/hosts-local.sh
set -euo pipefail

ETC_HOSTS="/etc/hosts"
ALIASES=(
  "127.0.0.1 mongo"
  "::1       mongo"
  "127.0.0.1 postgres"
  "::1       postgres"
)

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo:  sudo bash scripts/hosts-local.sh"
  exit 1
fi

added=0
for line in "${ALIASES[@]}"; do
  host="$(awk '{print $2}' <<<"$line")"
  if grep -qE "[[:space:]]${host}([[:space:]]|$)" "$ETC_HOSTS"; then
    echo "already present: $host"
  else
    printf '%s\n' "$line" >> "$ETC_HOSTS"
    echo "added: $line"
    added=$((added + 1))
  fi
done

echo
if [ "$added" -gt 0 ]; then
  echo "done. Now these resolve locally:"
fi
ping -c 1 -t 1 mongo >/dev/null 2>&1 && echo "  mongo    -> $(getent hosts mongo | awk '{print $1}') (ok)"
ping -c 1 -t 1 postgres >/dev/null 2>&1 && echo "  postgres -> $(getent hosts postgres | awk '{print $1}') (ok)"

echo
echo "Verify local brew services:"
brew services list 2>/dev/null | grep -iE "mongo|postgres" || true
