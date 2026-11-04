#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
BARLAS_HOME="${BARLAS_HOME:-$HOME/Library/Application Support/Barlas}"
NODE_EXE="$BARLAS_HOME/runtime/node/bin/node"
ENV_FILE="$ROOT_DIR/deploy/native.env"
DATA_DIR="$BARLAS_HOME/data"
LOG_DIR="$BARLAS_HOME/logs"
PID_FILE="$DATA_DIR/barlas.pid"
ENTRY_POINT="$ROOT_DIR/dist/src/native.js"
SERVICE_LABEL="com.barlas.agent"
SERVICE_FILE="$HOME/Library/LaunchAgents/$SERVICE_LABEL.plist"
mkdir -p "$DATA_DIR" "$LOG_DIR"
read_setting() {
  local name="$1" line value
  line="$(grep -m1 -E "^${name}=" "$ENV_FILE" 2>/dev/null || true)"
  value="${line#*=}"
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; value="${value//\'\\\'/\'}"; fi
  printf '%s' "$value"
}
valid_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid command_line; pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  command_line="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  [[ "$command_line" == *"$ENTRY_POINT"* ]]
}
launch_domain() {
  launchctl print "gui/$UID" >/dev/null 2>&1 && printf 'gui/%s' "$UID" || printf 'user/%s' "$UID"
}
PORT="$(read_setting PORT)"; PORT="${PORT:-17840}"
TOKEN="$(read_setting BARLAS_GATEWAY_TOKEN)"
