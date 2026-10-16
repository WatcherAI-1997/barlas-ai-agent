#!/bin/sh
set -eu

if [ "${ALLOW_BARLAS_WORKSPACE_RESTORE:-}" != "YES" ]; then
  echo "Set ALLOW_BARLAS_WORKSPACE_RESTORE=YES to confirm an intentional workspace restore." >&2
  exit 2
fi

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: ALLOW_BARLAS_WORKSPACE_RESTORE=YES deploy/restore-workspaces.sh /path/to/workspaces.tar.gz" >&2
  exit 2
fi

archive="$1"
volume="barlas-ai-agent-production-workspaces"
if [ -f "${archive}.sha256" ]; then
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "${archive}.sha256")")
fi

docker volume inspect "$volume" >/dev/null
docker run --rm -i --mount "type=volume,src=${volume},dst=/restore" alpine:3.22 \
  sh -c 'find /restore -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf - -C /restore' < "$archive"

echo "Barlas AI Agent workspace restore completed for ${volume}."
