#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/native-linux-common.sh"
if ! valid_pid; then rm -f -- "$PID_FILE"; printf 'Barlas is not running.\n'; exit 0; fi
pid="$(<"$PID_FILE")"; kill -TERM "$pid"
for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || { rm -f -- "$PID_FILE"; printf 'Barlas stopped.\n'; exit 0; }; sleep .2; done
kill -KILL "$pid" 2>/dev/null || true; rm -f -- "$PID_FILE"; printf 'Barlas stopped.\n'
