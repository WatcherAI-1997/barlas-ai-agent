#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/native-linux-common.sh"
purge=false; [[ "${1:-}" == --purge ]] && purge=true
[[ -n "$BARLAS_HOME" && "$BARLAS_HOME" != / && "$BARLAS_HOME" != "$HOME" ]] || { printf 'Unsafe Barlas home: %s\n' "$BARLAS_HOME" >&2; exit 1; }
"$ROOT_DIR/scripts/stop-native-linux.sh" || true
service_file="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/barlas.service"
if [[ -f "$service_file" ]] && head -n 1 "$service_file" | grep -Fqx '# Managed by Barlas native Linux installer'; then
  systemctl --user disable --now barlas.service >/dev/null 2>&1 || true
  rm -f -- "$service_file"; systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
launcher="${BARLAS_BIN_DIR:-$HOME/.local/bin}/barlas"
if [[ -L "$launcher" && "$(readlink -f -- "$launcher")" == "$ROOT_DIR/scripts/barlas-native-linux.sh" ]]; then rm -f -- "$launcher"; fi
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
