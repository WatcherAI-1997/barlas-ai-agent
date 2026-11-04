#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/native-macos-common.sh"
domain="$(launch_domain)"
if [[ -f "$SERVICE_FILE" ]] && launchctl print "$domain/$SERVICE_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$domain/$SERVICE_LABEL" >/dev/null 2>&1 || true
  for _ in {1..50}; do curl -fsS --max-time 1 "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1 || { printf 'Barlas stopped.\n'; exit 0; }; sleep .2; done
  printf 'Barlas stopped.\n'; exit 0
fi
if ! valid_pid; then rm -f -- "$PID_FILE"; printf 'Barlas is not running.\n'; exit 0; fi
pid="$(<"$PID_FILE")"; kill -TERM "$pid"
for _ in {1..50}; do kill -0 "$pid" 2>/dev/null || { rm -f -- "$PID_FILE"; printf 'Barlas stopped.\n'; exit 0; }; sleep .2; done
kill -KILL "$pid" 2>/dev/null || true; rm -f -- "$PID_FILE"; printf 'Barlas stopped.\n'
