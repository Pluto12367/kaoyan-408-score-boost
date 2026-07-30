#!/bin/sh
set -eu

if [ ! -f compose.production.yml ] || [ ! -f .env.production ]; then
  echo 'Run this installer from the directory containing compose.production.yml and .env.production.' >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo 'Installing /etc/cron.d/kaoyan408-backup requires root privileges.' >&2
  exit 1
fi

workdir=$(pwd -P)
backup_dir="$workdir/backups"
cron_file=/etc/cron.d/kaoyan408-backup

mkdir -p "$backup_dir"

printf '%s\n' \
  "15 3 * * * root cd \"$workdir\" && docker compose --env-file .env.production -f compose.production.yml --profile tools run --rm backup >> \"$backup_dir/backup.log\" 2>&1" \
  > "$cron_file"

chmod 0644 "$cron_file"
echo "Installed $cron_file"
