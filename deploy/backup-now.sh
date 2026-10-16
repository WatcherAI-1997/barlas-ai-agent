#!/bin/sh
set -eu

umask 077
mkdir -p /backups
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_target="/backups/barlas-ai-agent-${timestamp}.dump"
workspace_target="/backups/barlas-ai-agent-workspaces-${timestamp}.tar.gz"

pg_dump --format=custom --no-owner --no-acl --file="$database_target"
sha256sum "$database_target" > "${database_target}.sha256"
tar -C /workspaces -czf "$workspace_target" .
sha256sum "$workspace_target" > "${workspace_target}.sha256"
printf 'Backup created: %s and %s\n' "$(basename "$database_target")" "$(basename "$workspace_target")"
