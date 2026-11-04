#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BARLAS_HOME="${BARLAS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/barlas}"
NODE_EXE="$BARLAS_HOME/runtime/node/bin/node"
ENV_FILE="$ROOT_DIR/deploy/native.env"
DATA_DIR="$BARLAS_HOME/data"
LOG_DIR="$BARLAS_HOME/logs"
PID_FILE="$DATA_DIR/barlas.pid"
ENTRY_POINT="$ROOT_DIR/dist/src/native.js"
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
  local pid; pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/cmdline" ]] || return 1
  tr '\0' ' ' <"/proc/$pid/cmdline" | grep -Fq -- "$ENTRY_POINT"
}
PORT="$(read_setting PORT)"; PORT="${PORT:-17840}"
TOKEN="$(read_setting BARLAS_GATEWAY_TOKEN)"
