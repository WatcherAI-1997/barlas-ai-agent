#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/deploy/production.env"
REQUIRE_RUNNING=false
FAILURES=0
WARNINGS=0

usage() {
  cat <<'EOF'
Usage: ./scripts/doctor.sh [--env-file PATH] [--require-running]

Check Barlas AI Agent prerequisites, protected configuration, Compose validity,
container health, and the local API readiness endpoint. Secret values are never printed.
EOF
}

while (($#)); do
  case "$1" in
    --env-file) [[ $# -ge 2 ]] || { echo "--env-file needs a path" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --require-running) REQUIRE_RUNNING=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$ENV_FILE" == /* ]] || ENV_FILE="$ROOT_DIR/$ENV_FILE"

pass() { printf '✓ %s\n' "$1"; }
warning() { printf '! %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
failure() { printf '✗ %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }

for tool in docker curl openssl git; do
  if command -v "$tool" >/dev/null 2>&1; then pass "$tool is available"; else failure "$tool is missing"; fi
done
if docker compose version >/dev/null 2>&1; then pass "Docker Compose v2 is available"; else failure "Docker Compose v2 is unavailable"; fi

if [[ ! -f "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  failure "Production environment must be a regular, non-symlink file: $ENV_FILE"
else
  mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null || printf unknown)"
  if [[ "$mode" == "600" ]]; then pass "Production environment permissions are 0600"; else failure "Production environment permissions are $mode, expected 600"; fi
  if grep -Eq 'replace-with-|agent\.example\.com|owner@example\.com' "$ENV_FILE"; then failure "Production environment contains placeholders"; else pass "Production environment has no template placeholders"; fi
fi

export BARLAS_ENV_FILE="$ENV_FILE"
install_mode="$(sed -n "s/^BARLAS_INSTALL_MODE='\([^']*\)'$/\1/p" "$ENV_FILE" | tail -n 1)"
compose_files=(-f "$ROOT_DIR/compose.production.yml")
if [[ "$install_mode" == "local" ]]; then compose_files+=(-f "$ROOT_DIR/compose.local.yml"); fi
compose=(docker compose "${compose_files[@]}" --env-file "$ENV_FILE")
if [[ $FAILURES -eq 0 ]] && "${compose[@]}" config --quiet >/dev/null 2>&1; then
  pass "Production Compose configuration is valid"
else
  failure "Production Compose configuration is invalid"
fi

if ! docker info >/dev/null 2>&1; then
  if [[ "$REQUIRE_RUNNING" == true ]]; then failure "Docker daemon is unavailable"; else warning "Docker daemon is unavailable; runtime checks skipped"; fi
elif [[ $FAILURES -eq 0 ]]; then
  api_id="$("${compose[@]}" ps -q api 2>/dev/null || true)"
  if [[ -z "$api_id" ]]; then
    if [[ "$REQUIRE_RUNNING" == true ]]; then failure "API container is not running"; else warning "Stack is not running; configuration-only checks passed"; fi
  else
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id" 2>/dev/null || printf unknown)"
    if [[ "$health" == "healthy" ]]; then pass "API container is healthy"; else failure "API container health is $health"; fi
    if docker exec "$api_id" wget -q -O - http://127.0.0.1:17840/ready >/dev/null 2>&1; then pass "API /ready responds inside its isolated container"; else failure "API /ready check failed"; fi
    for service in database browser sandbox; do
      service_id="$("${compose[@]}" ps -q "$service" 2>/dev/null || true)"
      if [[ -z "$service_id" ]]; then
        failure "$service container is not running"
      else
        state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$service_id" 2>/dev/null || printf unknown)"
        if [[ "$state" == "healthy" || "$state" == "running" ]]; then pass "$service container is $state"; else failure "$service container state is $state"; fi
      fi
    done
  fi
fi

printf '\nDoctor result: %s failure(s), %s warning(s).\n' "$FAILURES" "$WARNINGS"
[[ $FAILURES -eq 0 ]]
