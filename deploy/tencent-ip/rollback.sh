#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <git-commit>" >&2
  exit 1
fi

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
cd "$script_dir/../.."

wait_for_gateway() {
  deadline=$(( $(date +%s) + 60 ))
  while :; do
    now=$(date +%s)
    remaining=$((deadline - now))
    if [ "$remaining" -le 0 ]; then
      return 1
    fi
    curl_timeout=2
    if [ "$remaining" -lt "$curl_timeout" ]; then
      curl_timeout=$remaining
    fi
    if curl -fsS --connect-timeout 1 --max-time "$curl_timeout" http://127.0.0.1/health >/dev/null; then
      return 0
    fi
    now=$(date +%s)
    remaining=$((deadline - now))
    if [ "$remaining" -le 0 ]; then
      return 1
    fi
    sleep 1
  done
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Engine and the Compose plugin are required.' >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required for the gateway health check.' >&2
  exit 1
fi

if [ ! -f .env.production ] || [ ! -f compose.production.yml ]; then
  echo 'Missing .env.production or compose.production.yml.' >&2
  exit 1
fi

if ! target_commit=$(git rev-parse --verify "$1^{commit}"); then
  echo "Target is not an existing commit: $1" >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo 'Working tree is not clean. Commit or remove changes before rollback.' >&2
  exit 1
fi

docker compose --env-file .env.production -f compose.production.yml config >/dev/null
echo 'Important: database migrations are not rolled back automatically.' >&2
echo 'Creating a database backup before rollback...'
docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup

original_commit=$(git rev-parse --verify HEAD)
rollback_complete=false

restore_original() {
  status=$?
  trap - EXIT

  if [ "$rollback_complete" != true ]; then
    echo 'Important: database migrations are not rolled back automatically.' >&2
    echo "Rollback failed; restoring original commit $original_commit and rebuilding its application image..." >&2
    git switch --detach "$original_commit" || echo 'Could not restore the original commit automatically.' >&2
    if docker compose --env-file .env.production -f compose.production.yml config >/dev/null \
      && docker compose --env-file .env.production -f compose.production.yml up -d --build --wait --wait-timeout 60 \
      && wait_for_gateway; then
      echo 'Original application version is healthy again.' >&2
    else
      echo 'Automatic recovery could not confirm health. Inspect Docker Compose logs immediately.' >&2
    fi
  fi

  exit "$status"
}
trap restore_original EXIT

git switch --detach "$target_commit"
docker compose --env-file .env.production -f compose.production.yml config >/dev/null
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait --wait-timeout 60

if ! wait_for_gateway; then
  echo 'Target version did not become healthy within 60 seconds.' >&2
  exit 1
fi

rollback_complete=true
trap - EXIT
echo "Rollback succeeded at commit $target_commit."
docker compose --env-file .env.production -f compose.production.yml ps
