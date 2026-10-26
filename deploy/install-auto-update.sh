#!/bin/bash
# Makes the server keep jarjar up to date by itself: every 5 minutes it checks GitHub for a newer commit
# on main and installs it once that commit's checks (CI) have passed. See update.sh.
#
#   Turn on (once):       sudo /opt/jarjar/deploy/install-auto-update.sh
#   See what it has done: journalctl -u jarjar-update -n 30
#   Turn off:             sudo systemctl disable --now jarjar-update.timer
#
# Check results are read from GitHub's public API, so this needs a public repository.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=${1:-main}

if ! command -v jq >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq jq >/dev/null
fi

# Follow $BRANCH. A clone made with --branch or --depth only fetches the branch it started on.
git remote set-branches origin "$BRANCH"
git fetch --quiet origin "$BRANCH"
if ! git cat-file -e "origin/$BRANCH:deploy/install-auto-update.sh" 2>/dev/null; then
  echo "$BRANCH on GitHub doesn't include auto-updating yet. Merge the pull request that adds it, then run this again." >&2
  exit 1
fi
git checkout --quiet --force -B "$BRANCH" "origin/$BRANCH"

cat > /etc/systemd/system/jarjar-update.service <<EOF
[Unit]
Description=Update jarjar to the newest version that passed its checks
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$PWD/deploy/update.sh --auto
TimeoutStartSec=30min
EOF

cat > /etc/systemd/system/jarjar-update.timer <<EOF
[Unit]
Description=Check for jarjar updates every 5 minutes

[Timer]
OnCalendar=*:0/5
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now jarjar-update.timer

echo "Auto-update is on: jarjar follows $BRANCH on GitHub. Building the current version now…"
deploy/update.sh
