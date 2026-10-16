#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"
INSTALL_LOG="$ROOT_DIR/logs/install.log"
NON_INTERACTIVE=false
PREPARE_ONLY=false
VERBOSE=false
ENV_CREATED=false
TEMP_FILE=""
SUPPORTED_LANGUAGE_CODES="tr az azb tk gag qxq kmz klj uz ug ili slr ybe kk ky kaa nog tt ba crh kum krc kdr uum cv sah dlg tyv kim alt kjh cjs clw fuy sty mn ru en"

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Prepare and start an isolated Barlas AI Agent production stack.

Options:
  --env-file PATH       Production environment file (default: deploy/production.env)
  --non-interactive     Read required values from environment variables; never prompt
  --prepare-only        Create and validate configuration without starting containers
  --verbose             Stream Docker build/start output instead of only logging it
  -h, --help            Show this help

Non-interactive required variables:
  BARLAS_DOMAIN, OWNER_EMAIL, MODEL_NAME, MODEL_API_KEY

Optional variables include DEEP_MODEL_NAME, VISION_MODEL, EMBEDDING_MODEL,
OWNER_DISPLAY_NAME, OWNER_LANGUAGE, TELEGRAM_BOT_TOKEN, and port/model settings.
EOF
}

while (($#)); do
  case "$1" in
    --env-file)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--env-file needs a path" >&2; exit 2; }
      ENV_FILE="$2"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --prepare-only|--config-only) PREPARE_ONLY=true; shift ;;
    --verbose) VERBOSE=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$ENV_FILE" != /* ]]; then ENV_FILE="$ROOT_DIR/$ENV_FILE"; fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_CYAN=$'\033[0;36m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[0;33m'; C_RED=$'\033[0;31m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_CYAN=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BOLD=""; C_RESET=""
fi

info() { printf '%s→%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

cleanup() {
  [[ -z "$TEMP_FILE" || ! -e "$TEMP_FILE" ]] || rm -f -- "$TEMP_FILE"
}
trap cleanup EXIT

run_logged() {
  local label="$1"; shift
  mkdir -p -- "$(dirname -- "$INSTALL_LOG")"
  if [[ "$VERBOSE" == true || ! -t 1 ]]; then
    info "$label"
    "$@" 2>&1 | tee -a "$INSTALL_LOG"
    return "${PIPESTATUS[0]}"
  fi
  info "$label"
  if "$@" >>"$INSTALL_LOG" 2>&1; then
    ok "$label"
  else
    printf '%s\n' "Last installer output:" >&2
    tail -n 25 "$INSTALL_LOG" >&2 || true
    fail "$label failed. Full log: $INSTALL_LOG"
  fi
}

command_exists() { command -v "$1" >/dev/null 2>&1; }
require_command() { command_exists "$1" || fail "Required command is missing: $1"; }

prompt() {
  local variable="$1" label="$2" default_value="${3:-}" secret="${4:-false}" value
  value="${!variable:-}"
  if [[ -z "$value" && "$NON_INTERACTIVE" == false ]]; then
    if [[ "$secret" == true ]]; then
      read -r -s -p "$label: " value; printf '\n'
    elif [[ -n "$default_value" ]]; then
      read -r -p "$label [$default_value]: " value; value="${value:-$default_value}"
    else
      read -r -p "$label: " value
    fi
  fi
  printf -v "$variable" '%s' "${value:-$default_value}"
}

require_value() {
  local variable="$1" label="$2" value suffix=""
  value="${!variable:-}"
  [[ "$NON_INTERACTIVE" == false ]] || suffix="; set $variable for non-interactive installation"
  [[ -n "$value" ]] || fail "$label is required$suffix"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "$label must be a single line"
}

require_single_line() {
  local variable="$1" value
  value="${!variable:-}"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail "$variable must be a single line"
}

env_value() {
  local value="$1"
  value="${value//\'/\\\'}"
  printf "'%s'" "$value"
}

write_setting() { printf '%s=%s\n' "$1" "$(env_value "$2")" >>"$TEMP_FILE"; }

print_banner() {
  printf '\n%s%sBarlas AI Agent Installer%s\n' "$C_BOLD" "$C_CYAN" "$C_RESET"
  printf '%s\n\n' 'Think ahead. Act beyond.'
}

print_banner
[[ "$(uname -s)" == "Linux" ]] || fail "The production installer currently supports Linux servers only"
for tool in docker openssl curl git; do require_command "$tool"; done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required (docker compose)"
[[ -r "$ROOT_DIR/compose.production.yml" ]] || fail "Run this installer from a complete Barlas AI Agent checkout"

if [[ -e "$ENV_FILE" ]]; then
  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "Environment path must be a regular, non-symlink file: $ENV_FILE"
  chmod 600 -- "$ENV_FILE"
  if grep -Eq 'replace-with-|agent\.example\.com|owner@example\.com' "$ENV_FILE"; then
    fail "Existing environment file still contains placeholders: $ENV_FILE"
  fi
  ok "Using existing protected configuration: $ENV_FILE"
else
  info "Creating a new protected production configuration"
  prompt BARLAS_DOMAIN "Domain name (without https://)"
  prompt BARLAS_HTTP_PORT "Host HTTP port" "18080"
  prompt BARLAS_HTTPS_PORT "Host HTTPS port" "18443"
  prompt OWNER_EMAIL "First owner email"
  prompt OWNER_DISPLAY_NAME "First owner display name" "Barlas Owner"
  prompt OWNER_LANGUAGE "Owner language code; blank means choose on first login" ""
  prompt MODEL_PROVIDER "Model provider" "openai"
  prompt MODEL_NAME "Fast/default model name"
  prompt DEEP_MODEL_NAME "Deep model name" "${MODEL_NAME:-}"
  prompt VISION_MODEL "Vision/PDF model name" "${MODEL_NAME:-}"
  prompt TRANSCRIPTION_MODEL "Transcription model" "gpt-4o-mini-transcribe"
  prompt SPEECH_MODEL "Speech model" "gpt-4o-mini-tts"
  prompt EMBEDDING_MODEL "Embedding model; blank disables semantic embeddings" ""
  prompt MODEL_API_KEY "Dedicated model API key" "" true
  prompt TELEGRAM_BOT_TOKEN "Dedicated Telegram bot token; blank disables Telegram" "" true
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    prompt TELEGRAM_WEBHOOK_SECRET "Telegram webhook secret; blank generates one" "" true
  else
    TELEGRAM_WEBHOOK_SECRET=""
  fi

  for variable in BARLAS_DOMAIN BARLAS_HTTP_PORT BARLAS_HTTPS_PORT OWNER_EMAIL OWNER_DISPLAY_NAME OWNER_LANGUAGE MODEL_PROVIDER MODEL_NAME DEEP_MODEL_NAME VISION_MODEL TRANSCRIPTION_MODEL SPEECH_MODEL EMBEDDING_MODEL MODEL_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
    require_single_line "$variable"
  done

  require_value BARLAS_DOMAIN "Domain"
  [[ "$BARLAS_DOMAIN" != *://* && "$BARLAS_DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$BARLAS_DOMAIN" == *.* ]] || fail "Domain must be a hostname such as agent.example.com"
  [[ "$BARLAS_DOMAIN" != *.example.com ]] || fail "Replace the example domain with the real hostname"
  require_value OWNER_EMAIL "Owner email"
  [[ "$OWNER_EMAIL" == *@*.* ]] || fail "Owner email is invalid"
  if [[ -n "$OWNER_LANGUAGE" && " $SUPPORTED_LANGUAGE_CODES " != *" $OWNER_LANGUAGE "* ]]; then
    fail "Owner language is unsupported; use one of: $SUPPORTED_LANGUAGE_CODES"
  fi
  require_value MODEL_NAME "Fast/default model name"
  require_value MODEL_API_KEY "Model API key"
  [[ "$MODEL_PROVIDER" == "openai" ]] || fail "This release supports the openai-compatible provider adapter"
  [[ "$BARLAS_HTTP_PORT" =~ ^[0-9]+$ && "$BARLAS_HTTPS_PORT" =~ ^[0-9]+$ ]] || fail "Ports must be numeric"
  ((BARLAS_HTTP_PORT >= 1 && BARLAS_HTTP_PORT <= 65535 && BARLAS_HTTPS_PORT >= 1 && BARLAS_HTTPS_PORT <= 65535)) || fail "Ports must be between 1 and 65535"
  [[ -z "${TELEGRAM_WEBHOOK_SECRET:-}" || ${#TELEGRAM_WEBHOOK_SECRET} -ge 32 ]] || fail "Telegram webhook secret must contain at least 32 characters"

  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
  BARLAS_API_TOKEN="$(openssl rand -hex 32)"
  BARLAS_GATEWAY_TOKEN="$(openssl rand -hex 32)"
  CONNECTOR_VAULT_KEY="$(openssl rand -base64 32 | tr -d '\n')"
  SANDBOX_SHARED_TOKEN="$(openssl rand -hex 32)"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -z "${TELEGRAM_WEBHOOK_SECRET:-}" ]]; then
    TELEGRAM_WEBHOOK_SECRET="$(openssl rand -hex 32)"
  fi

  mkdir -p -- "$(dirname -- "$ENV_FILE")"
  TEMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  chmod 600 -- "$TEMP_FILE"
  write_setting APP_NAME "Barlas AI Agent"
  write_setting BARLAS_DOMAIN "$BARLAS_DOMAIN"
  write_setting BARLAS_HTTP_PORT "$BARLAS_HTTP_PORT"
  write_setting BARLAS_HTTPS_PORT "$BARLAS_HTTPS_PORT"
  write_setting POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  write_setting BARLAS_API_TOKEN "$BARLAS_API_TOKEN"
  write_setting BARLAS_GATEWAY_TOKEN "$BARLAS_GATEWAY_TOKEN"
  write_setting MODEL_PROVIDER "$MODEL_PROVIDER"
  write_setting MODEL_NAME "$MODEL_NAME"
  write_setting MODEL_API_KEY "$MODEL_API_KEY"
  write_setting VISION_MODEL "$VISION_MODEL"
  write_setting TRANSCRIPTION_MODEL "$TRANSCRIPTION_MODEL"
  write_setting SPEECH_MODEL "$SPEECH_MODEL"
  write_setting EMBEDDING_MODEL "$EMBEDDING_MODEL"
  write_setting DEEP_MODEL_NAME "$DEEP_MODEL_NAME"
  write_setting CONNECTOR_VAULT_KEY "$CONNECTOR_VAULT_KEY"
  write_setting CONNECTOR_VAULT_KEY_VERSION "1"
  write_setting OWNER_EMAIL "$OWNER_EMAIL"
  write_setting OWNER_DISPLAY_NAME "$OWNER_DISPLAY_NAME"
  write_setting OWNER_LANGUAGE "$OWNER_LANGUAGE"
  write_setting BROWSER_WS_ENDPOINT "ws://browser:3000/"
  write_setting SANDBOX_SOCKET_PATH "/run/barlas-sandbox/sandbox.sock"
  write_setting SANDBOX_SHARED_TOKEN "$SANDBOX_SHARED_TOKEN"
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    write_setting TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN"
    write_setting TELEGRAM_WEBHOOK_SECRET "$TELEGRAM_WEBHOOK_SECRET"
  fi
  write_setting AGENT_RUN_WORKER_ENABLED "true"
  write_setting AGENT_RUN_WORKER_POLL_MS "1000"
  write_setting AGENT_RUN_WORKER_BATCH_SIZE "2"
  write_setting AGENT_RUN_LEASE_SECONDS "300"
  write_setting BACKUP_RETENTION_DAYS "14"
  write_setting BACKUP_INTERVAL_SECONDS "86400"
  mv -- "$TEMP_FILE" "$ENV_FILE"
  TEMP_FILE=""
  ENV_CREATED=true
  ok "Protected configuration created: $ENV_FILE"
fi

export BARLAS_ENV_FILE="$ENV_FILE"
run_logged "Validate the isolated production stack" docker compose -f "$ROOT_DIR/compose.production.yml" --env-file "$ENV_FILE" config --quiet

if [[ "$PREPARE_ONLY" == true ]]; then
  ok "Configuration is ready; containers were not started"
  printf 'Next: %q --env-file %q\n' "$ROOT_DIR/install.sh" "$ENV_FILE"
  exit 0
fi

docker info >/dev/null 2>&1 || fail "Docker daemon is unavailable to the current user"
if [[ "$ENV_CREATED" == true ]] && command_exists ss; then
  for port in "$BARLAS_HTTP_PORT" "$BARLAS_HTTPS_PORT"; do
    if ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; then
      fail "Host port $port is already in use; choose another port in $ENV_FILE before starting"
    fi
  done
fi

run_logged "Build and start Barlas AI Agent" docker compose -f "$ROOT_DIR/compose.production.yml" --env-file "$ENV_FILE" --profile backup up -d --build
run_logged "Run post-install diagnostics" "$ROOT_DIR/scripts/doctor.sh" --env-file "$ENV_FILE" --require-running

domain="$(sed -n 's/^BARLAS_DOMAIN=["'"']\{0,1\}\([^"'"']*\)["'"']\{0,1\}$/\1/p' "$ENV_FILE" | tail -n 1)"
https_port="$(sed -n 's/^BARLAS_HTTPS_PORT=["'"']\{0,1\}\([^"'"']*\)["'"']\{0,1\}$/\1/p' "$ENV_FILE" | tail -n 1)"
public_url="https://${domain}"
[[ "$https_port" == "443" ]] || public_url="${public_url}:${https_port}"

printf '\n%s%sInstallation complete.%s\n' "$C_GREEN" "$C_BOLD" "$C_RESET"
printf 'Web address: %s\n' "$public_url"
printf 'Dashboard access link: ./scripts/dashboard-url.sh --env-file %q\n' "$ENV_FILE"
printf 'Diagnostics: ./scripts/doctor.sh --env-file %q --require-running\n' "$ENV_FILE"
printf 'Logs: docker compose -f compose.production.yml --env-file %q logs -f api\n' "$ENV_FILE"
if [[ "$https_port" != "443" ]]; then
  warn "HTTPS is published on port $https_port. Use an external reverse proxy/port forward, or change to 443 after confirming it is free."
fi
printf 'Secrets remain only in %s (mode 0600); the installer never prints them.\n' "$ENV_FILE"
