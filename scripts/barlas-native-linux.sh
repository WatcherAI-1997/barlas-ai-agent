#!/usr/bin/env bash
set -Eeuo pipefail
launcher_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
root_dir="$(cd -- "$(dirname -- "$launcher_path")/.." && pwd)"
source "$root_dir/scripts/native-linux-common.sh"
command_name="${1:-}"
case "$command_name" in
  gateway|daemon)
    action="${2:-status}"
    case "$action" in
      start|run) exec "$root_dir/scripts/start-native-linux.sh" --wait ;;
      stop) exec "$root_dir/scripts/stop-native-linux.sh" ;;
      restart) "$root_dir/scripts/stop-native-linux.sh"; exec "$root_dir/scripts/start-native-linux.sh" --wait ;;
      status) curl -fsS --max-time 3 "http://127.0.0.1:$PORT/ready" >/dev/null && { printf 'Barlas Gateway: running\n'; exit 0; }; printf 'Barlas Gateway: stopped\n'; exit 1 ;;
      health) exec "$root_dir/scripts/doctor-native-linux.sh" ;;
      logs) tail_args=(-n 100); [[ "${3:-}" == --follow ]] && tail_args=(-n 100 -f); exec tail "${tail_args[@]}" "$LOG_DIR/native.out.log" ;;
      *) printf 'Unknown gateway action: %s\n' "$action" >&2; exit 2 ;;
    esac ;;
  start|stop|restart) exec "$0" gateway "$command_name" ;;
  doctor|health) exec "$root_dir/scripts/doctor-native-linux.sh" ;;
  dashboard)
    url="http://127.0.0.1:$PORT/#token=$TOKEN"
    if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true; fi
    printf '%s\n' "$url" ;;
  logs) shift; exec "$0" gateway logs "$@" ;;
  update|repair)
    if [[ "$command_name" == repair ]]; then exec "$root_dir/scripts/update-native-linux.sh" repair; fi
    exec "$root_dir/scripts/update-native-linux.sh" "${2:-update}" ;;
  uninstall)
    exec "$root_dir/scripts/uninstall-native-linux.sh" "${2:-}" ;;
  *)
    export BARLAS_URL="http://127.0.0.1:$PORT" BARLAS_GATEWAY_TOKEN="$TOKEN"
    exec "$NODE_EXE" "$root_dir/dist/src/cli.js" "$@" ;;
esac
