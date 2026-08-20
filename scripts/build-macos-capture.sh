#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
helper_script="$repo_root/plugins/screen-time/native/macos-capture/build-app.sh"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build:macos-capture requires macOS" >&2
  exit 2
fi

if [[ "${ECHOLOG_MACOS_ADHOC_SMOKE:-0}" == "1" ]]; then
  exec "$helper_script" --adhoc-smoke
fi

if [[ -z "${ECHOLOG_MACOS_SIGNING_IDENTITY:-}" ]]; then
  echo "set ECHOLOG_MACOS_SIGNING_IDENTITY for release signing, or ECHOLOG_MACOS_ADHOC_SMOKE=1 for local smoke assembly" >&2
  exit 2
fi

exec "$helper_script" --signing-identity "$ECHOLOG_MACOS_SIGNING_IDENTITY"
