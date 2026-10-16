#!/bin/sh
set -eu

base_url="${1:-https://${BARLAS_DOMAIN:-}}"
if [ "$base_url" = "https://" ]; then
  echo "Pass a base URL or set BARLAS_DOMAIN." >&2
  exit 2
fi

curl --fail --silent --show-error --max-time 15 "${base_url}/health"
curl --fail --silent --show-error --max-time 15 "${base_url}/ready"
echo
echo "Barlas AI Agent smoke test passed."
