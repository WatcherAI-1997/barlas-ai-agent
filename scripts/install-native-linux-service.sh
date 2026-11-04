#!/usr/bin/env bash
set -Eeuo pipefail
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
barlas_home="${BARLAS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/barlas}"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
service_dir="$config_home/systemd/user"; service_file="$service_dir/barlas.service"
command -v systemctl >/dev/null 2>&1 || { printf '[INFO] systemd user service unavailable; use barlas gateway start\n'; exit 0; }
mkdir -p "$service_dir"
existing=""; [[ -f "$service_file" ]] && existing="$(<"$service_file")"
managed='# Managed by Barlas native Linux installer'
[[ -z "$existing" || "$existing" == "$managed"* ]] || { printf '[WARN] Existing unmanaged barlas.service preserved\n'; exit 0; }
tmp="$service_file.tmp.$$"
{
  printf '%s\n[Unit]\nDescription=Barlas AI Agent\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=%s\nEnvironment=HOST=127.0.0.1\nEnvironmentFile=%s/deploy/native.env\nExecStart=%s/runtime/node/bin/node %s/dist/src/native.js\nRestart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n' "$managed" "$root_dir" "$root_dir" "$barlas_home" "$root_dir"
} >"$tmp"
mv -- "$tmp" "$service_file"
systemctl --user daemon-reload >/dev/null 2>&1 || { printf '[INFO] systemd user manager is not active; use barlas gateway start\n'; exit 0; }
systemctl --user enable barlas.service >/dev/null 2>&1 || true
printf '[OK] Per-user autostart configured\n'
