#!/bin/sh
set -eu

if [ "${ALLOW_BARLAS_RESTORE:-}" != "YES" ]; then
  echo "Set ALLOW_BARLAS_RESTORE=YES to confirm an intentional restore." >&2
  exit 2
fi

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: ALLOW_BARLAS_RESTORE=YES deploy/restore.sh /path/to/backup.dump" >&2
  exit 2
fi

backup_file="$1"
docker compose -f compose.production.yml --env-file deploy/production.env exec -T database \
  pg_restore --clean --if-exists --no-owner --no-acl -U barlas_agent -d barlas_agent < "$backup_file"
