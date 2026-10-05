#!/usr/bin/env bash
# Prints local database connection details (brew services, no docker).
# Usage:  bash scripts/db-info.sh
set -euo pipefail

IP="$(ipconfig getifaddr en0 2>/dev/null || echo '<your-ip>')"

echo "================= DB CONNECTION INFO (local brew) ================="
echo "MongoDB    : $(/opt/homebrew/opt/mongodb-community/bin/mongod --version 2>/dev/null | head -1 || echo 'mongodb-community (brew)')"
echo "  raw local: mongodb://localhost:27017        (no auth; credentials ignored)"
echo "  LAN      : mongodb://${IP}:27017"
echo "  connect  : mongosh \"mongodb://localhost:27017\""
echo "  data dir : /opt/homebrew/var/mongodb"
echo "-------------------------------------------------------"
echo "PostgreSQL: $(psql -d postgres -tAc 'select version();' 2>/dev/null | grep -o 'PostgreSQL [0-9.]*' || echo 'postgresql@18 (brew)')"
echo "  host     : localhost:5432"
echo "  LAN      : ${IP}:5432"
echo "  user     : $(whoami)   default db: postgres"
echo "  connect  : psql -d postgres"
echo "  data dir : /opt/homebrew/var/postgresql@18"
echo "================================================================"
echo
echo "Canonical URIs (same string works for docker, after: sudo bash scripts/hosts-local.sh)"
echo "  MONGODB_URI=mongodb://<user>:<pass>@mongo:27017/<db>?authSource=<db>"
echo "  PG_URI     =postgres://<user>:<pass>@postgres:5432/<db>"
