#!/bin/sh
set -eu

umask 077
mkdir -p /backups

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="/backups/barlas-ai-agent-${timestamp}.dump"
  pg_dump --format=custom --no-owner --no-acl --file="$target"
  sha256sum "$target" > "${target}.sha256"
  workspace_target="/backups/barlas-ai-agent-workspaces-${timestamp}.tar.gz"
  tar -C /workspaces -czf "$workspace_target" .
  sha256sum "$workspace_target" > "${workspace_target}.sha256"
  find /backups -maxdepth 1 -type f -name 'barlas-ai-agent-*' -mtime "+${BACKUP_RETENTION_DAYS:-14}" -delete
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
