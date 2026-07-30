#!/bin/sh
set -eu

script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
cd "$script_dir/../.."

invalid_env() {
  echo "$1 is invalid." >&2
  exit 1
}

read_env_value() {
  variable_name=$1
  sed -n -E "s/^[[:space:]]*$variable_name[[:space:]]*=[[:space:]]*([^[:space:]#]+)[[:space:]]*(#.*)?$/\\1/p" .env.production | tail -n 1
}

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

PUBLIC_IP=$(read_env_value PUBLIC_IP)
POSTGRES_USER=$(read_env_value POSTGRES_USER)
POSTGRES_PASSWORD=$(read_env_value POSTGRES_PASSWORD)
POSTGRES_DB=$(read_env_value POSTGRES_DB)
JWT_SECRET=$(read_env_value JWT_SECRET)
BACKUP_RETENTION_DAYS=$(read_env_value BACKUP_RETENTION_DAYS)

if [ -z "$PUBLIC_IP" ] || ! printf '%s\n' "$PUBLIC_IP" | awk -F. 'NF == 4 { for (index = 1; index <= 4; index += 1) if ($index !~ /^[0-9]+$/ || $index > 255) exit 1; exit 0 } { exit 1 }'; then
  invalid_env PUBLIC_IP
fi

case "$POSTGRES_USER" in
  ''|*[!A-Za-z0-9_]*|[0-9]*) invalid_env POSTGRES_USER ;;
esac
if [ "${#POSTGRES_USER}" -gt 63 ]; then
  invalid_env POSTGRES_USER
fi

case "$POSTGRES_PASSWORD" in
  ''|generate-a-base64url-password|*[!A-Za-z0-9_-]*) invalid_env POSTGRES_PASSWORD ;;
esac
if [ "${#POSTGRES_PASSWORD}" -lt 24 ]; then
  invalid_env POSTGRES_PASSWORD
fi

case "$POSTGRES_DB" in
  ''|*[!A-Za-z0-9_]*|[0-9]*) invalid_env POSTGRES_DB ;;
esac
if [ "${#POSTGRES_DB}" -gt 63 ]; then
  invalid_env POSTGRES_DB
fi

case "$JWT_SECRET" in
  ''|generate-a-random-secret-with-at-least-32-characters) invalid_env JWT_SECRET ;;
esac
if [ "${#JWT_SECRET}" -lt 32 ]; then
  invalid_env JWT_SECRET
fi

case "$BACKUP_RETENTION_DAYS" in
  ''|*[!0-9]*) invalid_env BACKUP_RETENTION_DAYS ;;
esac
if [ "$BACKUP_RETENTION_DAYS" -lt 1 ] || [ "$BACKUP_RETENTION_DAYS" -gt 365 ]; then
  invalid_env BACKUP_RETENTION_DAYS
fi

docker compose --env-file .env.production -f compose.production.yml config >/dev/null

postgres_container=$(docker compose --env-file .env.production -f compose.production.yml ps --all -q postgres)
if [ -n "$postgres_container" ]; then
  postgres_state=$(docker inspect --format '{{.State.Status}}' "$postgres_container")
  postgres_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_container")
  if [ "$postgres_state" != running ] || [ "$postgres_health" != healthy ]; then
    echo 'Existing PostgreSQL container is not running and healthy; refusing deployment before a verified backup.' >&2
    exit 1
  fi

  echo 'Creating a database backup before deployment...'
  docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup
elif [ -n "$(docker volume ls --filter 'label=com.docker.compose.project=kaoyan408' --filter 'label=com.docker.compose.volume=postgres_data' -q)" ]; then
  echo 'A PostgreSQL data volume exists without a discoverable PostgreSQL container; refusing first-deployment path.' >&2
  exit 1
else
  echo 'No existing PostgreSQL container or data volume found; skipping backup for the first deployment.'
fi

docker compose --env-file .env.production -f compose.production.yml up -d --build --wait --wait-timeout 60

if ! wait_for_gateway; then
  echo 'Gateway health check did not succeed within 60 seconds.' >&2
  exit 1
fi

echo "Deployment succeeded. Open: http://$PUBLIC_IP"
docker compose --env-file .env.production -f compose.production.yml ps
