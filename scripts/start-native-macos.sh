#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/native-macos-common.sh"
wait_ready=false; [[ "${1:-}" == --wait ]] && wait_ready=true
[[ -x "$NODE_EXE" ]] || { printf 'Private Node.js runtime is missing\n' >&2; exit 1; }
[[ -f "$ENV_FILE" && -f "$ENTRY_POINT" ]] || { printf 'Native installation is incomplete\n' >&2; exit 1; }
domain="$(launch_domain)"
if [[ -f "$SERVICE_FILE" ]]; then
  if ! launchctl print "$domain/$SERVICE_LABEL" >/dev/null 2>&1; then launchctl bootstrap "$domain" "$SERVICE_FILE" >/dev/null 2>&1 || true; fi
fi
if [[ -f "$SERVICE_FILE" ]] && launchctl print "$domain/$SERVICE_LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "$domain/$SERVICE_LABEL"
  pid="$(launchctl print "$domain/$SERVICE_LABEL" 2>/dev/null | awk '/pid =/{print $3; exit}')"
else
  if valid_pid; then pid="$(<"$PID_FILE")"; else rm -f -- "$PID_FILE"; nohup "$NODE_EXE" --env-file="$ENV_FILE" "$ENTRY_POINT" >>"$LOG_DIR/native.out.log" 2>>"$LOG_DIR/native.error.log" </dev/null & pid=$!; printf '%s\n' "$pid" >"$PID_FILE"; fi
fi
if [[ "$wait_ready" == true ]]; then
  for _ in {1..90}; do curl -fsS --max-time 2 "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1 && { printf '[OK] Barlas native runtime is ready\n'; exit 0; }; [[ -z "${pid:-}" ]] || kill -0 "$pid" 2>/dev/null || break; sleep 2; done
  tail -n 20 "$LOG_DIR/native.error.log" 2>/dev/null || true
  printf 'Barlas did not become ready. Log: %s/native.error.log\n' "$LOG_DIR" >&2; exit 1
fi
printf 'Barlas started%s.\n' "$([[ -n "${pid:-}" ]] && printf ' (PID %s)' "$pid")"
