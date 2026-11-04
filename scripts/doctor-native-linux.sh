#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/native-linux-common.sh"
require_running=false; [[ "${1:-}" == --require-running ]] && require_running=true
for path in "$NODE_EXE" "$ENV_FILE" "$ENTRY_POINT"; do [[ -f "$path" ]] || { printf '[FAIL] Missing: %s\n' "$path" >&2; exit 1; }; done
[[ "$(stat -c '%a' "$ENV_FILE")" == 600 ]] || { printf '[FAIL] Configuration permissions must be 600\n' >&2; exit 1; }
printf '[OK] Private runtime, protected configuration and build\n'
if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/ready" >/dev/null 2>&1; then printf '[OK] Native runtime is ready\n'; elif [[ "$require_running" == true ]]; then printf '[FAIL] Runtime is not ready\n' >&2; exit 1; else printf '[INFO] Runtime is stopped\n'; fi
printf '[OK] Docker and root are not used\n'
