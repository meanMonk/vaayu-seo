#!/usr/bin/env bash
# Daily Mongo backup via cron on the VPS. Add to crontab:
#   0 3 * * * bash /var/www/vaayu-seo/vps/backup-mongo.sh
# Keeps 14 daily dumps inside the mongo container volume (/backups).
set -euo pipefail

REPO="${1:-/var/www/vaayu-seo}"
source "$REPO/.env"
docker exec vaayu-mongo mongodump \
  --uri "mongodb://${MONGO_ROOT_USER:-admin}:${MONGO_ROOT_PASSWORD}@localhost:27017/?authSource=admin" \
  --out "/backups/$(date +%F)"
docker exec vaayu-mongo sh -c 'find /backups -type d -mtime +14 -exec rm -rf {} +'

echo "backup ok $(date)"
