#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="$script_dir/build"
signing_identity=""
adhoc_smoke=0

usage() {
  echo "usage: $0 (--signing-identity ID | --adhoc-smoke) [--output DIR]" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --signing-identity)
      [[ $# -ge 2 ]] || usage
      signing_identity="$2"
      shift 2
      ;;
    --adhoc-smoke)
      adhoc_smoke=1
      shift
      ;;
    --output)
      [[ $# -ge 2 ]] || usage
      output_dir="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

if [[ $adhoc_smoke -eq 1 && -n "$signing_identity" ]]; then
  echo "choose either --adhoc-smoke or --signing-identity" >&2
  exit 2
fi
if [[ $adhoc_smoke -eq 0 && -z "$signing_identity" ]]; then
  echo "release assembly requires --signing-identity; use --adhoc-smoke only for local smoke testing" >&2
  exit 2
fi

cd "$script_dir"
/usr/bin/swift build -c release --disable-index-store
bin_dir="$(/usr/bin/swift build -c release --disable-index-store --show-bin-path)"
app="$output_dir/EchoLogScreenCapture.app"
executable="$app/Contents/MacOS/echolog-screen-capture"

/bin/rm -rf "$app"
/bin/mkdir -p "$app/Contents/MacOS"
/usr/bin/install -m 0755 "$bin_dir/echolog-screen-capture" "$executable"
/usr/bin/install -m 0644 "$script_dir/Resources/Info.plist" "$app/Contents/Info.plist"

if [[ $adhoc_smoke -eq 1 ]]; then
  signing_identity="-"
  /usr/bin/codesign \
    --force \
    --sign "$signing_identity" \
    --timestamp=none \
    --requirements '=designated => identifier "com.cubeplus1.echolog.screen-capture"' \
    "$app"
else
  /usr/bin/codesign --force --sign "$signing_identity" --options runtime --timestamp "$app"
fi
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"

bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")"
minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")"
[[ "$bundle_id" == "com.cubeplus1.echolog.screen-capture" ]] || { echo "unexpected bundle identifier: $bundle_id" >&2; exit 1; }
[[ "$minimum_os" == "14.0" ]] || { echo "unexpected minimum OS: $minimum_os" >&2; exit 1; }
signature_details="$(/usr/bin/codesign --display --verbose=2 "$app" 2>&1)"
signature_identifier="$(/usr/bin/sed -n 's/^Identifier=//p' <<<"$signature_details")"
[[ "$signature_identifier" == "com.cubeplus1.echolog.screen-capture" ]] || { echo "unexpected signature identifier: $signature_identifier" >&2; exit 1; }
designated_requirement="$(/usr/bin/codesign --display --requirements - "$app" 2>&1)"
/usr/bin/grep -Fq 'identifier "com.cubeplus1.echolog.screen-capture"' <<<"$designated_requirement" || { echo "designated requirement does not bind the expected identifier" >&2; exit 1; }
/usr/bin/file "$executable" | /usr/bin/grep -Eq 'Mach-O 64-bit executable (arm64|x86_64)'

status_json="$("$executable" status --json)"
STATUS_JSON="$status_json" /usr/bin/python3 -c 'import json, os; value=json.loads(os.environ["STATUS_JSON"]); assert value["ok"] is True; assert value["command"] == "status"; assert value["bundleIdentifier"] == "com.cubeplus1.echolog.screen-capture"; assert value["permission"] in ("granted", "request-needed")'

echo "$app"
