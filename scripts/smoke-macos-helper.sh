#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
target_root="$repo_root"
launchd_plist=""

usage() {
  cat >&2 <<'EOF'
usage: scripts/smoke-macos-helper.sh [--root DIR] [--launchd [PLIST]]

Verifies the packaged EchoLogScreenCapture.app at the runtime path used by
screen-time. With --launchd, reads WorkingDirectory from the daemon plist and
checks that installed runtime tree instead of this source checkout.
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      [[ $# -ge 2 ]] || usage
      target_root="$2"
      shift 2
      ;;
    --launchd)
      launchd_plist="${2:-$HOME/Library/LaunchAgents/com.echolog.daemon.plist}"
      if [[ $# -ge 2 && "$2" != --* ]]; then
        shift 2
      else
        shift
      fi
      ;;
    *) usage ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS is required" >&2; exit 2; }

if [[ -n "$launchd_plist" ]]; then
  [[ -f "$launchd_plist" ]] || { echo "launchd plist not found: $launchd_plist" >&2; exit 1; }
  target_root="$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$launchd_plist")"
fi

target_root="$(cd "$target_root" && pwd)"
app="$target_root/plugins/screen-time/native/macos-capture/build/EchoLogScreenCapture.app"
executable="$app/Contents/MacOS/echolog-screen-capture"
build_command="ECHOLOG_MACOS_ADHOC_SMOKE=1 pnpm build:macos-capture"

if [[ ! -d "$app" ]]; then
  echo "EchoLogScreenCapture.app is missing at $app" >&2
  echo "build it with: (cd $target_root && $build_command)" >&2
  exit 1
fi
if [[ ! -x "$executable" ]]; then
  echo "screen capture helper executable is missing or not runnable at $executable" >&2
  echo "build it with: (cd $target_root && $build_command)" >&2
  exit 1
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "$app" >/dev/null
status_json="$("$executable" status --json)"
STATUS_JSON="$status_json" /usr/bin/python3 - <<'PY'
import json
import os

value = json.loads(os.environ["STATUS_JSON"])
assert value["ok"] is True
assert value["command"] == "status"
assert value["bundleIdentifier"] == "com.cubeplus1.echolog.screen-capture"
assert value["permission"] in ("granted", "request-needed")
PY

echo "helper_root=$target_root"
echo "helper_app=$app"
echo "helper_status=$status_json"
