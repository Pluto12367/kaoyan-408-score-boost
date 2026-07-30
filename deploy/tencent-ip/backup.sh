#!/bin/sh
set -eu

backup_dir=/backups
retention_days=${BACKUP_RETENTION_DAYS:-14}

case "$retention_days" in
  ''|*[!0-9]*)
    echo 'BACKUP_RETENTION_DAYS must be a non-negative integer' >&2
    exit 1
    ;;
esac

umask 077
mkdir -p "$backup_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$backup_dir/kaoyan408-$timestamp.dump"
checksum_path="$backup_path.sha256"

pg_dump --format=custom --file="$backup_path"

if [ ! -s "$backup_path" ]; then
  echo "Backup archive is empty: $backup_path" >&2
  exit 1
fi

sha256sum "$backup_path" > "$checksum_path"

find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.dump' -mtime +"$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.dump.sha256' -mtime +"$retention_days" -delete

echo "Created backup archive: $backup_path"
