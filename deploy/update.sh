#!/bin/bash
# Pulls the latest code and rebuilds jarjar. Run on the server: sudo /opt/jarjar/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy
docker compose up -d --build
docker image prune -f
