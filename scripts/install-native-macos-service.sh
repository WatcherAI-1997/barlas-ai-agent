#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/native-macos-common.sh"
service_dir="$HOME/Library/LaunchAgents"
mkdir -p "$service_dir"
managed='<!-- Managed by Barlas native macOS installer -->'
if [[ -f "$SERVICE_FILE" ]] && ! grep -Fq "$managed" "$SERVICE_FILE"; then
  printf '[WARN] Existing unmanaged %s preserved\n' "$SERVICE_FILE"
  exit 0
fi
xml_escape() { local value="$1"; value="${value//&/&amp;}"; value="${value//</&lt;}"; value="${value//>/&gt;}"; printf '%s' "$value"; }
tmp="$SERVICE_FILE.tmp.$$"
{
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' '<plist version="1.0"><dict>' "$managed"
  printf '<key>Label</key><string>%s</string>\n' "$SERVICE_LABEL"
  printf '<key>ProgramArguments</key><array><string>%s</string><string>--env-file=%s</string><string>%s</string></array>\n' "$(xml_escape "$NODE_EXE")" "$(xml_escape "$ENV_FILE")" "$(xml_escape "$ENTRY_POINT")"
  printf '<key>WorkingDirectory</key><string>%s</string>\n' "$(xml_escape "$ROOT_DIR")"
  printf '<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>\n'
  printf '<key>ProcessType</key><string>Background</string>\n'
  printf '<key>StandardOutPath</key><string>%s</string><key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$LOG_DIR/native.out.log")" "$(xml_escape "$LOG_DIR/native.error.log")"
  printf '</dict></plist>\n'
} >"$tmp"
chmod 600 "$tmp"
mv -- "$tmp" "$SERVICE_FILE"
domain="$(launch_domain)"
launchctl bootout "$domain/$SERVICE_LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$SERVICE_FILE" >/dev/null 2>&1 || { printf '[INFO] launchd session unavailable; use barlas gateway start\n'; exit 0; }
printf '[OK] Per-user launchd autostart configured\n'
