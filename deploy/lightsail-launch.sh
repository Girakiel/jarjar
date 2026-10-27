#!/bin/bash
# First-boot setup for jarjar on an Ubuntu 24.04 Lightsail (or EC2) instance.
# Fill in the values below, then paste the whole file into "Launch script" when creating the instance.
# Progress is logged to /var/log/jarjar-setup.log on the server.
set -euo pipefail

# Address the dashboard and tracker will live at. Its DNS record must point at this server.
JARJAR_DOMAIN="jarjar.edugamitec.com"
# The repo is private: a fine-grained GitHub token with read-only "Contents" access to it.
# Leave empty if the repo is public.
GITHUB_TOKEN=""
REPO="Girakiel/jarjar"
# The server installs every commit on this branch once its checks pass (see install-auto-update.sh).
BRANCH="main"

exec > >(tee -a /var/log/jarjar-setup.log) 2>&1
echo "jarjar setup started $(date)"

# Building the dashboard needs more memory than the smallest plans have.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

curl -fsSL https://get.docker.com | sh

if [ -n "$GITHUB_TOKEN" ]; then
  url="https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
else
  url="https://github.com/${REPO}.git"
fi
git clone --depth 1 --branch "$BRANCH" "$url" /opt/jarjar
chmod 700 /opt/jarjar

echo "JARJAR_DOMAIN=${JARJAR_DOMAIN}" > /opt/jarjar/deploy/.env
# Builds and starts jarjar, and keeps it up to date from then on.
/opt/jarjar/deploy/install-auto-update.sh "$BRANCH"

echo "jarjar setup finished $(date): open https://${JARJAR_DOMAIN}"
