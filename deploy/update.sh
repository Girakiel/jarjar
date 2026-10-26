#!/bin/bash
# Brings jarjar up to date with the branch this checkout follows (main) and rebuilds it.
#
#   sudo /opt/jarjar/deploy/update.sh          update now
#   sudo /opt/jarjar/deploy/update.sh --auto   what the auto-update timer runs every 5 minutes: does nothing
#                                              unless there's a newer commit whose checks on GitHub passed
#
# If the new version doesn't build or start, the previous one is put back.
set -euo pipefail

STATE_DIR=${JARJAR_STATE_DIR:-/var/lib/jarjar}
AUTO=false
[ "${1:-}" = "--auto" ] && AUTO=true
cd "$(dirname "$0")/.."

compose() { (cd deploy && docker compose "$@"); }

# Prints a message. The timer runs every 5 minutes, so in auto mode a message is only repeated when it changes.
note() {
  if $AUTO && [ "$(cat "$STATE_DIR/last-note" 2>/dev/null)" = "$*" ]; then return 0; fi
  echo "$*"
  echo "$*" > "$STATE_DIR/last-note"
}

# owner/repo of the GitHub remote.
github_repo() {
  local url
  url=$(git remote get-url origin)
  url=${url%/}
  url=${url%.git}
  echo "${url#*github.com[:/]}"
}

# passed, pending, failed or unknown: the combined result of the checks (CI) GitHub ran on a commit.
checks_status() {
  local json
  json=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$(github_repo)/commits/$1/check-runs?per_page=100" 2>/dev/null) || { echo unknown; return 0; }
  jq -r '
    if .total_count == 0 or any(.check_runs[]; .status != "completed") then "pending"
    elif all(.check_runs[]; .conclusion == "success" or .conclusion == "neutral" or .conclusion == "skipped") then "passed"
    else "failed" end' <<<"$json" 2>/dev/null || echo unknown
}

# Checks out a commit and builds and starts it. Explicit returns because callers use it in an `if`, where set -e is off.
deploy() {
  git reset --quiet --hard "$1" || return 1
  export JARJAR_COMMIT JARJAR_COMMIT_DATE
  JARJAR_COMMIT=$(git rev-parse --short=7 HEAD)
  JARJAR_COMMIT_DATE=$(git log -1 --format=%cI)
  if $AUTO; then
    compose build --quiet || return 1
  else
    compose build || return 1
  fi
  compose up -d || return 1
}

# Waits up to 2 minutes for the server to answer.
healthy() {
  local _
  for _ in $(seq 40); do
    sleep 3
    if compose exec -T jarjar wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

main() {
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/update.lock"
  if ! flock -n 9; then
    $AUTO && return 0
    echo "An update is already running. Try again in a few minutes." >&2
    return 1
  fi

  local branch current latest
  branch=$(git rev-parse --abbrev-ref HEAD)
  git fetch --quiet origin "$branch"
  current=$(git rev-parse HEAD)
  latest=$(git rev-parse FETCH_HEAD)

  if $AUTO; then
    [ "$current" = "$latest" ] && return 0
    # A version that failed to start isn't retried automatically; the next commit, or a manual update, is.
    [ "$(cat "$STATE_DIR/failed-commit" 2>/dev/null)" = "$latest" ] && return 0
    case "$(checks_status "$latest")" in
      passed) ;;
      pending) note "${latest:0:7} is waiting for its checks on GitHub to finish."; return 0 ;;
      failed) note "Not updating to ${latest:0:7}: its checks on GitHub failed."; return 0 ;;
      *) note "Not updating to ${latest:0:7}: couldn't get its check results from GitHub."; return 0 ;;
    esac
  elif [ "$current" = "$latest" ]; then
    echo "Already on the newest commit of $branch (${current:0:7}). Rebuilding it."
  elif command -v jq >/dev/null && [ "$(checks_status "$latest")" = failed ]; then
    echo "Note: ${latest:0:7} failed its checks on GitHub. Installing it anyway."
  fi

  [ "$current" != "$latest" ] && note "Updating jarjar from ${current:0:7} to ${latest:0:7}…"
  if deploy "$latest" && healthy; then
    rm -f "$STATE_DIR/failed-commit"
    note "jarjar is running ${latest:0:7}."
    docker image prune -f >/dev/null
    docker builder prune -f --filter until=168h >/dev/null
    return 0
  fi

  echo "$latest" > "$STATE_DIR/failed-commit"
  if [ "$current" = "$latest" ]; then
    note "jarjar ${latest:0:7} didn't start. Details: cd $PWD/deploy && sudo docker compose logs jarjar"
    return 1
  fi
  note "${latest:0:7} didn't build or start, so going back to ${current:0:7}."
  if deploy "$current" && healthy; then
    note "Back on ${current:0:7}. To see what went wrong: cd $PWD/deploy && sudo docker compose logs jarjar"
  else
    note "${current:0:7} didn't start either. Details: cd $PWD/deploy && sudo docker compose logs jarjar"
  fi
  return 1
}

# On one line so bash has read it before git replaces this file.
main; exit
