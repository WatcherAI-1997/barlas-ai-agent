#!/bin/sh
set -eu

umask 077
mkdir -p /backups

while true; do
  /opt/barlas/backup-now.sh
  find /backups -maxdepth 1 -type f -name 'barlas-ai-agent-*' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
