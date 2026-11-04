#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/native-linux-common.sh"
action="${1:-update}"
api='https://api.github.com/repos/WatcherAI-1997/barlas-ai-agent/commits/main'
bootstrap='https://raw.githubusercontent.com/WatcherAI-1997/barlas-ai-agent/main/install-linux-native.sh'
version_file="$ROOT_DIR/.barlas-version"
current="unknown"; [[ -f "$version_file" ]] && current="$(<"$version_file")"
latest="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$api" | "$NODE_EXE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).sha;if(!/^[a-f0-9]{40}$/.test(v))process.exit(1);process.stdout.write(v)})')"
case "$action" in
  check)
    printf 'Current: %s\nLatest:  %s\n' "$current" "$latest"
    [[ "$current" == "$latest" ]] && printf 'Barlas is up to date.\n' || printf 'Update available.\n' ;;
  update|repair)
    [[ "$action" == repair || "$current" != "$latest" ]] || { printf 'Barlas is up to date.\n'; exit 0; }
    temp_script="$(mktemp "${TMPDIR:-/tmp}/barlas-bootstrap.XXXXXX")"
    trap 'rm -f -- "$temp_script"' EXIT
    curl -fsSL --retry 3 "$bootstrap" -o "$temp_script"
    BARLAS_HOME="$BARLAS_HOME" bash "$temp_script" ;;
  rollback)
    previous="$BARLAS_HOME/previous"; swap="$BARLAS_HOME/rollback-swap"
    [[ -d "$previous" ]] || { printf 'No previous Barlas version is available.\n' >&2; exit 1; }
    [[ ! -e "$swap" ]] || { printf 'Rollback recovery path already exists: %s\n' "$swap" >&2; exit 1; }
    "$ROOT_DIR/scripts/stop-native-linux.sh" || true
    mv -- "$ROOT_DIR" "$swap"
    if mv -- "$previous" "$ROOT_DIR"; then
      cp -- "$swap/deploy/native.env" "$ROOT_DIR/deploy/native.env"; chmod 600 "$ROOT_DIR/deploy/native.env"
      mv -- "$swap" "$previous"
      exec "$ROOT_DIR/scripts/start-native-linux.sh" --wait
    fi
    mv -- "$swap" "$ROOT_DIR"; printf 'Rollback failed; current version restored.\n' >&2; exit 1 ;;
  *) printf 'Usage: barlas update [check|update|rollback|repair]\n' >&2; exit 2 ;;
esac
