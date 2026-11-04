#!/usr/bin/env bash
set -Eeuo pipefail

NODE_VERSION="24.18.0"
REPOSITORY="WatcherAI-1997/barlas-ai-agent"
RELEASE_API="https://api.github.com/repos/${REPOSITORY}/commits/main"
BARLAS_HOME="${BARLAS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/barlas}"
APP_DIR="$BARLAS_HOME/app"
PREVIOUS_DIR="$BARLAS_HOME/previous"
RUNTIME_DIR="$BARLAS_HOME/runtime"
BIN_DIR="${BARLAS_BIN_DIR:-$HOME/.local/bin}"
LOG_DIR="$BARLAS_HOME/logs"
INSTALL_LOG="$LOG_DIR/install.log"
SOURCE_DIR=""
NON_INTERACTIVE=false
NO_START=false

while (($#)); do
  case "$1" in
    --source-dir) SOURCE_DIR="${2:?--source-dir needs a path}"; shift 2 ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --no-start) NO_START=true; shift ;;
    -h|--help) printf 'Usage: %s [--source-dir PATH] [--non-interactive] [--no-start]\n' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/barlas-install.XXXXXX")"
cleanup() { rm -rf -- "$work_dir"; }
trap cleanup EXIT
mkdir -p "$BARLAS_HOME" "$RUNTIME_DIR" "$BIN_DIR" "$LOG_DIR"
: >"$INSTALL_LOG"
chmod 700 "$BARLAS_HOME" "$LOG_DIR"

step() { printf '\n\033[31m  %02d/05\033[0m  %s\n' "$1" "$2"; }
done_line() { printf '         \033[32mOK\033[0m  %s\n' "$1"; }
fail() { printf '\nInstallation stopped: %s\nLog: %s\n' "$1" "$INSTALL_LOG" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required"; }

printf '\n\033[31m  ●  ●\033[0m   BARLAS\n\033[31m    ●\033[0m     AI AGENT\n  THINK AHEAD. ACT BEYOND.\n'
need curl
need tar

arch="$(uname -m)"
case "$arch" in x86_64|amd64) node_arch="x64" ;; aarch64|arm64) node_arch="arm64" ;; *) fail "Unsupported architecture: $arch" ;; esac

step 1 "Preparing private runtime"
node_exe="$RUNTIME_DIR/node/bin/node"
npm_exe="$RUNTIME_DIR/node/bin/npm"
if [[ ! -x "$node_exe" ]]; then
  node_archive="$work_dir/node.tar.xz"
  curl -fL --retry 3 "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o "$node_archive" >>"$INSTALL_LOG" 2>&1
  mkdir -p "$work_dir/node"
  tar -xJf "$node_archive" -C "$work_dir/node" >>"$INSTALL_LOG" 2>&1
  extracted_node="$(find "$work_dir/node" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [[ -x "$extracted_node/bin/node" ]] || fail "Downloaded Node.js runtime is incomplete"
  rm -rf -- "$RUNTIME_DIR/node"
  mv -- "$extracted_node" "$RUNTIME_DIR/node"
fi
done_line "Node.js $($node_exe --version) ready"

step 2 "Loading Barlas"
release_sha=""
staged="$work_dir/source"
if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd)"
  [[ -f "$SOURCE_DIR/package-lock.json" && -f "$SOURCE_DIR/src/native.ts" ]] || fail "Source directory is incomplete"
  mkdir -p "$staged"
  tar -C "$SOURCE_DIR" --exclude=.git --exclude=node_modules --exclude=dist --exclude=deploy/native.env -cf - . | tar -C "$staged" -xf -
  release_sha="$(git -C "$SOURCE_DIR" rev-parse HEAD 2>/dev/null || printf 'local-source')"
else
  release_sha="$(curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' "$RELEASE_API" | "$node_exe" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).sha;if(!/^[a-f0-9]{40}$/.test(v))process.exit(1);process.stdout.write(v)})')" || fail "GitHub did not return a valid release"
  archive="$work_dir/barlas.tar.gz"
  curl -fL --retry 3 "https://github.com/${REPOSITORY}/archive/${release_sha}.tar.gz" -o "$archive" >>"$INSTALL_LOG" 2>&1
  mkdir -p "$staged"
  tar -xzf "$archive" -C "$staged" --strip-components=1 >>"$INSTALL_LOG" 2>&1
fi
[[ -f "$staged/install-linux-native.sh" ]] || fail "Downloaded Barlas archive is incomplete"
done_line "Barlas source ready"

existing_env=""
[[ -f "$APP_DIR/deploy/native.env" ]] && existing_env="$work_dir/native.env" && cp -- "$APP_DIR/deploy/native.env" "$existing_env"
"$APP_DIR/scripts/stop-native-linux.sh" >/dev/null 2>&1 || true
rm -rf -- "$PREVIOUS_DIR"
[[ ! -d "$APP_DIR" ]] || mv -- "$APP_DIR" "$PREVIOUS_DIR"
mv -- "$staged" "$APP_DIR"
[[ -z "$existing_env" ]] || { mkdir -p "$APP_DIR/deploy"; cp -- "$existing_env" "$APP_DIR/deploy/native.env"; chmod 600 "$APP_DIR/deploy/native.env"; }

rollback() {
  code=$?
  if ((code != 0)); then
    printf '\nInstall failed; restoring previous application.\n' >&2
    rm -rf -- "$APP_DIR"
    [[ ! -d "$PREVIOUS_DIR" ]] || mv -- "$PREVIOUS_DIR" "$APP_DIR"
  fi
  exit "$code"
}
trap rollback ERR

step 3 "Building application"
(cd "$APP_DIR" && "$npm_exe" ci --include=dev --ignore-scripts --no-fund --no-audit && "$npm_exe" run build) >>"$INSTALL_LOG" 2>&1
done_line "Application built"

step 4 "Preparing browser"
(cd "$APP_DIR" && "$node_exe" node_modules/playwright-core/cli.js install chromium) >>"$INSTALL_LOG" 2>&1
done_line "Private Chromium ready"

step 5 "Personal setup"
BARLAS_HOME="$BARLAS_HOME" BARLAS_NODE="$node_exe" BARLAS_NON_INTERACTIVE="$NON_INTERACTIVE" "$APP_DIR/scripts/configure-native-linux.sh"
printf '%s\n' "$release_sha" >"$APP_DIR/.barlas-version"
chmod +x "$APP_DIR/scripts/"*"native-linux"*.sh "$APP_DIR/scripts/barlas-native-linux.sh"
ln -sfn "$APP_DIR/scripts/barlas-native-linux.sh" "$BIN_DIR/barlas"
BARLAS_HOME="$BARLAS_HOME" "$APP_DIR/scripts/install-native-linux-service.sh"
if [[ "$NO_START" == false ]]; then BARLAS_HOME="$BARLAS_HOME" "$APP_DIR/scripts/start-native-linux.sh" --wait; fi
BARLAS_HOME="$BARLAS_HOME" "$APP_DIR/scripts/doctor-native-linux.sh" $([[ "$NO_START" == false ]] && printf '%s' '--require-running')
trap - ERR

printf '\n\033[32mBarlas is ready — Docker and root were not used.\033[0m\n'
printf 'Command: %s/barlas\nDashboard: %s/barlas dashboard\n' "$BIN_DIR" "$BIN_DIR"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then printf 'Add to your shell PATH: export PATH="%s:$PATH"\n' "$BIN_DIR"; fi
