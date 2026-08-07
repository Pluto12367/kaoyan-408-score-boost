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

is_globally_reachable_ipv4() {
  printf '%s\n' "$1" | awk -F. '
    NF != 4 { exit 1 }
    {
      for (octet = 1; octet <= 4; octet += 1) {
        if ($octet !~ /^(0|[1-9][0-9]?[0-9]?)$/ || $octet > 255) exit 1
      }
      first = $1 + 0
      second = $2 + 0
      third = $3 + 0
      if (first == 0 || first == 10 || (first == 100 && second >= 64 && second <= 127) ||
          first == 127 || (first == 169 && second == 254) ||
          (first == 172 && second >= 16 && second <= 31) ||
          (first == 192 && second == 0 && (third == 0 || third == 2)) ||
          (first == 192 && second == 88 && third == 99) ||
          (first == 192 && second == 168) ||
          (first == 198 && second >= 18 && second <= 19) ||
          (first == 198 && second == 51 && third == 100) ||
          (first == 203 && second == 0 && third == 113) ||
          (first >= 224 && first <= 239) || first >= 240) exit 1
      exit 0
    }
  '
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

if [ -z "$PUBLIC_IP" ] || ! is_globally_reachable_ipv4 "$PUBLIC_IP"; then
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
compose_config=$(docker compose --env-file .env.production -f compose.production.yml config --format json)
compose_project=$(printf '%s\n' "$compose_config" | sed -n -E 's/^[[:space:]]*"name":[[:space:]]*"([^"]+)"[[:space:]]*,?[[:space:]]*$/\1/p' | sed -n '1p')
case "$compose_project" in
  ''|*[!a-z0-9_-]*)
    echo 'Could not determine the Compose project name.' >&2
    exit 1
    ;;
esac

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
elif [ -n "$(docker volume ls --filter "label=com.docker.compose.project=$compose_project" --filter 'label=com.docker.compose.volume=postgres_data' -q)" ]; then
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

echo 'Seeding 408 evidence data (idempotent, safe on every deploy)...'
docker compose --env-file .env.production -f compose.production.yml exec -T app node scripts/seed-408-v2.mjs

echo "Deployment succeeded. Open: http://$PUBLIC_IP"
docker compose --env-file .env.production -f compose.production.yml ps
