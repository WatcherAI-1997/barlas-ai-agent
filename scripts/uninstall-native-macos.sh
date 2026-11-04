#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/native-macos-common.sh"
purge=false; [[ "${1:-}" == --purge ]] && purge=true
[[ -n "$BARLAS_HOME" && "$BARLAS_HOME" != / && "$BARLAS_HOME" != "$HOME" ]] || { printf 'Unsafe Barlas home: %s\n' "$BARLAS_HOME" >&2; exit 1; }
"$ROOT_DIR/scripts/stop-native-macos.sh" || true
if [[ -f "$SERVICE_FILE" ]] && grep -Fq 'Managed by Barlas native macOS installer' "$SERVICE_FILE"; then
  domain="$(launch_domain)"
  launchctl bootout "$domain/$SERVICE_LABEL" >/dev/null 2>&1 || true
  rm -f -- "$SERVICE_FILE"
fi
launcher="${BARLAS_BIN_DIR:-$HOME/.local/bin}/barlas"
if [[ -L "$launcher" ]] && [[ "$(readlink "$launcher")" == "$ROOT_DIR/scripts/barlas-native-macos.sh" ]]; then rm -f -- "$launcher"; fi
if [[ "$purge" == true ]]; then
  printf 'Type DELETE to remove application, configuration, memory and workspaces: '; read -r answer
  [[ "$answer" == DELETE ]] || { printf 'Purge cancelled.\n'; exit 0; }
  rm -rf -- "$BARLAS_HOME"
  printf 'Barlas and all local data were removed.\n'
else
  preserved="$BARLAS_HOME/data"
  rm -rf -- "$BARLAS_HOME/app" "$BARLAS_HOME/previous" "$BARLAS_HOME/runtime"
  printf 'Barlas application removed. Data preserved at %s\n' "$preserved"
fi
