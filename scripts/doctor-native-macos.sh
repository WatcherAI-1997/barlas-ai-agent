#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/native-macos-common.sh"
require_running=false; [[ "${1:-}" == --require-running ]] && require_running=true
[[ "$(uname -s)" == Darwin ]] || { printf '[FAIL] Native macOS doctor requires macOS\n' >&2; exit 1; }
for path in "$NODE_EXE" "$ENV_FILE" "$ENTRY_POINT"; do [[ -f "$path" ]] || { printf '[FAIL] Missing: %s\n' "$path" >&2; exit 1; }; done
permissions="$(stat -f '%Lp' "$ENV_FILE")"
[[ "$permissions" == 600 ]] || { printf '[FAIL] Configuration permissions must be 600 (found %s)\n' "$permissions" >&2; exit 1; }
printf '[OK] Private runtime, protected configuration and build\n'
if [[ -f "$SERVICE_FILE" ]] && grep -Fq 'Managed by Barlas native macOS installer' "$SERVICE_FILE"; then printf '[OK] Per-user launchd service installed\n'; else printf '[INFO] launchd service is not installed\n'; fi
if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then printf '[OK] Native runtime is ready\n'; elif [[ "$require_running" == true ]]; then printf '[FAIL] Runtime is not ready\n' >&2; exit 1; else printf '[INFO] Runtime is stopped\n'; fi
printf '[OK] Docker, Homebrew and root are not used\n'
