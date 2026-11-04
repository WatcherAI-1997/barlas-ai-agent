#!/usr/bin/env bash
set -Eeuo pipefail
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
barlas_home="${BARLAS_HOME:-$HOME/Library/Application Support/Barlas}"
node_exe="${BARLAS_NODE:-$barlas_home/runtime/node/bin/node}"
env_file="$root_dir/deploy/native.env"
mkdir -p "$root_dir/deploy" "$barlas_home/data/workspaces"
if [[ -f "$env_file" ]]; then chmod 600 "$env_file"; printf '[OK] Existing protected configuration preserved\n'; exit 0; fi

non_interactive="${BARLAS_NON_INTERACTIVE:-false}"
language="${OWNER_LANGUAGE:-ru}"
email="${OWNER_EMAIL:-owner@barlas.local}"
name="${OWNER_DISPLAY_NAME:-Barlas Owner}"
provider="${MODEL_PROVIDER:-codex_cli}"
model="${MODEL_NAME:-gpt-6.1-sol}"
if [[ "$non_interactive" != true && -t 0 ]]; then
  printf 'Language [ru]: '; read -r answer; language="${answer:-$language}"
  printf 'Owner email [owner@barlas.local]: '; read -r answer; email="${answer:-$email}"
  printf 'Display name [Barlas Owner]: '; read -r answer; name="${answer:-$name}"
  printf 'Model provider (codex_cli/openai/anthropic/ollama/openai_compatible) [codex_cli]: '; read -r answer; provider="${answer:-$provider}"
  case "$provider" in ollama) model="${MODEL_NAME:-qwen3:8b}" ;; anthropic) model="${MODEL_NAME:-claude-sonnet-4-5}" ;; esac
fi
case "$provider" in codex_cli|openai|anthropic|ollama|openai_compatible) ;; *) printf 'Unsupported model provider: %s\n' "$provider" >&2; exit 1 ;; esac
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { printf 'Invalid owner email\n' >&2; exit 1; }
random_hex() { "$node_exe" -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('hex'))"; }
random_b64() { "$node_exe" -e "process.stdout.write(require('node:crypto').randomBytes($1).toString('base64'))"; }
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
api_token="$(random_hex 32)"; gateway_token="$(random_hex 32)"; vault_key="$(random_b64 32)"
tmp="$env_file.tmp.$$"
umask 077
{
  printf 'APP_ENV=production\nAPP_NAME=%s\nBARLAS_INSTALL_MODE=native-macos\nHOST=127.0.0.1\nPORT=17840\nBARLAS_HTTP_PORT=17840\n' "$(quote 'Barlas AI Agent')"
  printf 'DATABASE_URL=postgresql://native-runtime\nBARLAS_NATIVE_ROOT=%s\nBARLAS_NATIVE_DATA=%s\nBARLAS_NATIVE_DATABASE_PORT=17841\n' "$(quote "$root_dir")" "$(quote "$barlas_home/data")"
  printf 'BARLAS_API_TOKEN=%s\nBARLAS_GATEWAY_TOKEN=%s\nMODEL_PROVIDER=%s\nMODEL_NAME=%s\n' "$(quote "$api_token")" "$(quote "$gateway_token")" "$(quote "$provider")" "$(quote "$model")"
  printf 'MODEL_API_KEY=%s\nMODEL_BASE_URL=%s\nOLLAMA_BASE_URL=http://127.0.0.1:11434\n' "$(quote "${MODEL_API_KEY:-}")" "$(quote "${MODEL_BASE_URL:-}")"
  printf 'CONNECTOR_VAULT_KEY=%s\nCONNECTOR_VAULT_KEY_VERSION=1\nOWNER_EMAIL=%s\nOWNER_DISPLAY_NAME=%s\nOWNER_LANGUAGE=%s\n' "$(quote "$vault_key")" "$(quote "$email")" "$(quote "$name")" "$(quote "$language")"
  printf 'WORKSPACE_ROOT=%s\nWEB_ROOT=%s\nTELEGRAM_POLLING_ENABLED=false\nDISCORD_GATEWAY_ENABLED=false\nSLACK_SOCKET_MODE_ENABLED=false\n' "$(quote "$barlas_home/data/workspaces")" "$(quote "$root_dir/web")"
} >"$tmp"
chmod 600 "$tmp"
mv -- "$tmp" "$env_file"
printf '[OK] Protected native macOS configuration created\n'
