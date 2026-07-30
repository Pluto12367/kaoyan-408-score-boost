#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <dump-path>" >&2
  exit 1
fi

dump_path=$1
if [ ! -f "$dump_path" ] || [ ! -r "$dump_path" ] || [ ! -s "$dump_path" ]; then
  echo "Dump path must be a readable, non-empty file: $dump_path" >&2
  exit 1
fi

dump_directory=$(cd "$(dirname "$dump_path")" && pwd -P)
dump_name=$(basename "$dump_path")
dump_path="$dump_directory/$dump_name"
restore_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
container_name="kaoyan408-restore-drill-$restore_id"
network_name="kaoyan408-restore-network-$restore_id"
restore_user=restore_user
restore_password=restore_password
restore_db=restore_db

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network_name" >/dev/null
docker run -d --rm \
  --name "$container_name" \
  --network "$network_name" \
  -e POSTGRES_USER="$restore_user" \
  -e POSTGRES_PASSWORD="$restore_password" \
  -e POSTGRES_DB="$restore_db" \
  postgres:16-alpine >/dev/null

attempt=0
until docker exec "$container_name" pg_isready -U "$restore_user" -d "$restore_db" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo 'Temporary restore PostgreSQL did not become ready.' >&2
    exit 1
  fi
  sleep 1
done

docker cp "$dump_path" "$container_name:/tmp/backup.dump"
docker exec -e PGPASSWORD="$restore_password" "$container_name" \
  pg_restore --exit-on-error --no-owner --no-privileges \
  --username="$restore_user" --dbname="$restore_db" /tmp/backup.dump

tables_ready=$(docker exec -e PGPASSWORD="$restore_password" "$container_name" \
  psql --no-psqlrc --tuples-only --no-align --quiet \
  --username="$restore_user" --dbname="$restore_db" \
  --command="SELECT CASE WHEN to_regclass('\"User\"') IS NOT NULL AND to_regclass('\"Question\"') IS NOT NULL THEN 'ok' ELSE 'missing' END;")

if [ "$tables_ready" != 'ok' ]; then
  echo 'Restored database is missing required Prisma tables.' >&2
  exit 1
fi

echo "Restore verification succeeded in isolated container: $container_name"
