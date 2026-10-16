#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"

if [[ "${1:-}" == "--env-file" ]]; then
  [[ -n "${2:-}" ]] || { echo "--env-file needs a path" >&2; exit 2; }
  ENV_FILE="$2"
elif [[ -n "${1:-}" ]]; then
  echo "Usage: ./scripts/dashboard-url.sh [--env-file PATH]" >&2
  exit 2
fi
[[ "$ENV_FILE" == /* ]] || ENV_FILE="$ROOT_DIR/$ENV_FILE"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo "Protected environment file not found" >&2; exit 1; }

read_setting() {
  sed -n "s/^$1='\([^']*\)'$/\1/p" "$ENV_FILE" | tail -n 1
}

domain="$(read_setting BARLAS_DOMAIN)"
mode="$(read_setting BARLAS_INSTALL_MODE)"
http_port="$(read_setting BARLAS_HTTP_PORT)"
port="$(read_setting BARLAS_HTTPS_PORT)"
token="$(read_setting BARLAS_GATEWAY_TOKEN)"
[[ ${#token} -ge 32 ]] || { echo "Gateway access configuration is incomplete" >&2; exit 1; }

if [[ "$mode" == "local" ]]; then
  [[ -n "$http_port" ]] || { echo "Local web port is missing" >&2; exit 1; }
  url="http://127.0.0.1:${http_port}"
else
  [[ -n "$domain" && -n "$port" ]] || { echo "Public gateway configuration is incomplete" >&2; exit 1; }
  url="https://${domain}"
  [[ "$port" == "443" ]] || url="${url}:${port}"
fi
printf '%s/#token=%s\n' "$url" "$token"
