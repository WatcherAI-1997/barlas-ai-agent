#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE=""
ACTION="update"
TARGET="origin/main"
REQUIRE_SIGNED=false
YES=false
STATE_FILE="$ROOT_DIR/deploy/update-state"

usage() {
  cat <<'EOF'
Usage: ./scripts/update.sh [--check | --rollback] [options]

Safely update a configured Barlas checkout or roll back its application code.

Options:
  --check               Fetch and report the available commit without changing state
  --rollback            Return to the previous recorded application commit
  --to REF              Update to a commit reachable from origin/main (default: origin/main)
  --require-signed      Require git verify-commit to succeed for the target
  --env-file PATH       Protected environment (auto-detects local.env/production.env)
  --yes                 Skip the interactive commit confirmation
  -h, --help            Show this help

The update creates database and workspace backups first. Database restore is
never automatic; migrations must remain forward-compatible across app rollback.
EOF
}

while (($#)); do
  case "$1" in
    --check) ACTION="check"; shift ;;
    --rollback) ACTION="rollback"; shift ;;
    --to) [[ $# -ge 2 ]] || { echo "--to needs a ref" >&2; exit 2; }; TARGET="$2"; shift 2 ;;
    --require-signed) REQUIRE_SIGNED=true; shift ;;
    --env-file) [[ $# -ge 2 ]] || { echo "--env-file needs a path" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --yes) YES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

cd -- "$ROOT_DIR"
if [[ -z "$ENV_FILE" ]]; then
  if [[ -f deploy/local.env ]]; then ENV_FILE="deploy/local.env"; else ENV_FILE="deploy/production.env"; fi
fi
[[ "$ENV_FILE" == /* ]] || ENV_FILE="$ROOT_DIR/$ENV_FILE"
[[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] || { echo "Protected environment not found: $ENV_FILE" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { echo "Refusing to update a dirty worktree" >&2; exit 1; }

install_mode="$(sed -n "s/^BARLAS_INSTALL_MODE='\([^']*\)'$/\1/p" "$ENV_FILE" | tail -n 1)"
compose_files=(-f "$ROOT_DIR/compose.production.yml")
if [[ "$install_mode" == "local" ]]; then compose_files+=(-f "$ROOT_DIR/compose.local.yml"); fi
export BARLAS_ENV_FILE="$ENV_FILE"
compose=(docker compose "${compose_files[@]}" --env-file "$ENV_FILE")

if [[ "$ACTION" == "rollback" ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" ]] || { echo "No rollback state is available" >&2; exit 1; }
  previous="$(sed -n 's/^PREVIOUS_SHA=//p' "$STATE_FILE" | tail -n 1)"
  [[ "$previous" =~ ^[a-f0-9]{40}$ ]] && git cat-file -e "${previous}^{commit}" || { echo "Rollback commit is invalid" >&2; exit 1; }
  current="$(git rev-parse HEAD)"
  printf 'Rollback application %s -> %s\n' "${current:0:12}" "${previous:0:12}"
  [[ "$YES" == true ]] || { read -r -p "Continue? [y/N] " answer; [[ "$answer" =~ ^[Yy]$ ]] || exit 0; }
  git switch --detach "$previous"
  if "${compose[@]}" --profile backup up -d --build && "$ROOT_DIR/scripts/doctor.sh" --env-file "$ENV_FILE" --require-running; then
    printf 'Application rollback complete. Database was not restored.\n'
    exit 0
  fi
  git switch --detach "$current"
  "${compose[@]}" --profile backup up -d --build
  echo "Rollback failed; restored the current application commit" >&2
  exit 1
fi

git fetch --prune origin main
current="$(git rev-parse HEAD)"
target="$(git rev-parse "${TARGET}^{commit}")"
git merge-base --is-ancestor "$target" origin/main || { echo "Target is not reachable from origin/main" >&2; exit 1; }
git merge-base --is-ancestor "$current" "$target" || { echo "Only fast-forward updates are allowed" >&2; exit 1; }
if [[ "$REQUIRE_SIGNED" == true ]]; then git verify-commit "$target"; fi
printf 'Current:   %s\nAvailable: %s\n' "$current" "$target"
[[ "$current" != "$target" ]] || { echo "Barlas is already up to date"; exit 0; }
[[ "$ACTION" == "check" ]] && exit 0
[[ "$YES" == true ]] || { read -r -p "Back up and update? [y/N] " answer; [[ "$answer" =~ ^[Yy]$ ]] || exit 0; }

"${compose[@]}" --profile backup run --rm --no-deps --entrypoint /opt/barlas/backup-now.sh backup
umask 077
printf 'PREVIOUS_SHA=%s\nTARGET_SHA=%s\n' "$current" "$target" > "$STATE_FILE"
chmod 600 "$STATE_FILE"
git switch --detach "$target"
if "${compose[@]}" --profile backup up -d --build && "$ROOT_DIR/scripts/doctor.sh" --env-file "$ENV_FILE" --require-running; then
  printf 'Update complete: %s\nRollback command: ./scripts/update.sh --rollback\n' "${target:0:12}"
  exit 0
fi

echo "Update health check failed; rolling application code back" >&2
git switch --detach "$current"
"${compose[@]}" --profile backup up -d --build
"$ROOT_DIR/scripts/doctor.sh" --env-file "$ENV_FILE" --require-running
exit 1
