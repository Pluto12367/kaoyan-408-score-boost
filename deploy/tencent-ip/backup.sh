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
backup_name=$(basename "$backup_path")
checksum_path="$backup_dir/$backup_name.sha256"
asset_source=${QUESTION_IMPORT_PERMANENT_DIR:-}
asset_path="$backup_dir/kaoyan408-$timestamp.assets.tar.gz"
asset_name=$(basename "$asset_path")

pg_dump --format=custom --file="$backup_path"

if [ ! -s "$backup_path" ]; then
  echo "Backup archive is empty: $backup_path" >&2
  exit 1
fi

(cd "$backup_dir" && sha256sum "$backup_name" > "$(basename "$checksum_path")")

# The application prepares this read-only permanent-asset directory before invoking
# the backup tool; incoming and temporary originals are deliberately excluded.
if [ -n "$asset_source" ] && [ -d "$asset_source" ]; then
  tar -C "$asset_source" -czf "$asset_path" .
  if [ ! -s "$asset_path" ]; then
    echo "Question import asset archive is empty: $asset_path" >&2
    exit 1
  fi
  (cd "$backup_dir" && sha256sum "$asset_name" > "$asset_name.sha256")
fi

find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.dump' -mtime +"$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.dump.sha256' -mtime +"$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.assets.tar.gz' -mtime +"$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'kaoyan408-*.assets.tar.gz.sha256' -mtime +"$retention_days" -delete

echo "Created backup archive: $backup_path"
