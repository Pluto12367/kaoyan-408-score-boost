#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
cd "$script_dir/../.."

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required. Install Docker Engine and the Compose plugin before deploying.' >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose plugin is required.' >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required for the gateway health check.' >&2
  exit 1
fi

if [ ! -f .env.production ]; then
  echo 'Missing .env.production. Copy deploy/tencent-ip/.env.production.example and set real secrets.' >&2
  exit 1
fi

if [ ! -f compose.production.yml ]; then
  echo 'Missing compose.production.yml. Run this script from a complete repository checkout.' >&2
  exit 1
fi

PUBLIC_IP=$(sed -n -E 's/^[[:space:]]*PUBLIC_IP[[:space:]]*=[[:space:]]*([^[:space:]#]+)[[:space:]]*(#.*)?$/\1/p' .env.production | tail -n 1)
if [ -z "$PUBLIC_IP" ]; then
  echo 'PUBLIC_IP must be set in .env.production.' >&2
  exit 1
fi

if ! printf '%s\n' "$PUBLIC_IP" | awk -F. 'NF == 4 { for (index = 1; index <= 4; index += 1) if ($index !~ /^[0-9]+$/ || $index > 255) exit 1; exit 0 } { exit 1 }'; then
  echo 'PUBLIC_IP must be an IPv4 address.' >&2
  exit 1
fi

docker compose --env-file .env.production -f compose.production.yml config >/dev/null

postgres_container=$(docker compose --env-file .env.production -f compose.production.yml ps -q postgres)
if [ -n "$postgres_container" ]; then
  postgres_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_container")
  if [ "$postgres_health" != healthy ]; then
    echo 'Existing PostgreSQL container is not healthy; refusing deployment before a verified backup.' >&2
    exit 1
  fi

  echo 'Creating a database backup before deployment...'
  docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup
else
  echo 'No existing PostgreSQL container found; skipping backup for the first deployment.'
fi

docker compose --env-file .env.production -f compose.production.yml up -d --build --wait --wait-timeout 60

attempt=0
until curl -fsS http://127.0.0.1/health >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'Gateway health check did not succeed within 60 seconds.' >&2
    exit 1
  fi
  sleep 1
done

echo "Deployment succeeded. Open: http://$PUBLIC_IP"
docker compose --env-file .env.production -f compose.production.yml ps
