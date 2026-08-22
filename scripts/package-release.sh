#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
version=""
source_ref="HEAD"
signing_mode=""
output_dir=""

usage() {
  cat >&2 <<'EOF'
usage: scripts/package-release.sh --version VERSION (--adhoc | --signing-identity ID) [--source-ref REF] [--output DIR]

Builds a macOS arm64 ready-to-run archive from an isolated Git snapshot.
The archive includes source, compiled Node artifacts, locked production dependencies,
and EchoLogScreenCapture.app. Ad-hoc output is not notarized.
EOF
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || usage
      version="$2"
      shift 2
      ;;
    --source-ref)
      [[ $# -ge 2 ]] || usage
      source_ref="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || usage
      output_dir="$2"
      shift 2
      ;;
    --adhoc)
      [[ -z "$signing_mode" ]] || usage
      signing_mode="adhoc"
      shift
      ;;
    --signing-identity)
      [[ $# -ge 2 && -z "$signing_mode" ]] || usage
      signing_mode="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ -n "$version" && -n "$signing_mode" ]] || usage
[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS is required" >&2; exit 2; }
[[ "$(uname -m)" == "arm64" ]] || { echo "this release target requires macOS arm64" >&2; exit 2; }

for command_name in git node pnpm shasum tar; do
  command -v "$command_name" >/dev/null || { echo "missing required command: $command_name" >&2; exit 2; }
done

pnpm_store_path="$(pnpm store path)"

git -C "$repo_root" cat-file -e "${source_ref}^{commit}"
source_commit="$(git -C "$repo_root" rev-parse "${source_ref}^{commit}")"
source_version="$(git -C "$repo_root" show "${source_ref}:package.json" | node -e 'let value=""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => console.log(JSON.parse(value).version));')"
[[ "$source_version" == "$version" ]] || {
  echo "package.json at $source_ref has version $source_version, expected $version" >&2
  exit 2
}

if [[ -z "$output_dir" ]]; then
  output_dir="$repo_root/release/v$version"
fi
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/echolog-release.XXXXXX")"
cleanup() {
  /bin/rm -rf "$temp_root"
}
trap cleanup EXIT

bundle_name="echolog-v${version}-macos-arm64"
bundle_root="$temp_root/$bundle_name"
git -C "$repo_root" archive --format=tar --prefix="$bundle_name/" "$source_ref" | tar -xf - -C "$temp_root"

cd "$bundle_root"
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm typecheck

swift_test_result="passed"
if /usr/bin/swift -e 'import XCTest' >/dev/null 2>&1; then
  (
    cd plugins/screen-time/native/macos-capture
    /usr/bin/swift test --disable-index-store
  )
else
  swift_test_result="skipped-xctest-unavailable"
  echo "warning: XCTest is unavailable in the active developer toolchain; Swift tests are skipped" >&2
fi

if [[ "$signing_mode" == "adhoc" ]]; then
  ECHOLOG_MACOS_ADHOC_SMOKE=1 pnpm build:macos-capture
  signature_kind="adhoc"
  archive_suffix="adhoc"
else
  ECHOLOG_MACOS_SIGNING_IDENTITY="$signing_mode" pnpm build:macos-capture
  signature_kind="developer-id"
  archive_suffix="signed"
fi

app_path="$bundle_root/plugins/screen-time/native/macos-capture/build/EchoLogScreenCapture.app"
app_executable="$app_path/Contents/MacOS/echolog-screen-capture"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")"
bundle_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app_path/Contents/Info.plist")"
[[ "$bundle_id" == "com.cubeplus1.echolog.screen-capture" ]] || { echo "unexpected bundle id: $bundle_id" >&2; exit 1; }
[[ "$bundle_version" == "$version" ]] || { echo "unexpected app version: $bundle_version" >&2; exit 1; }
[[ "$minimum_os" == "14.0" ]] || { echo "unexpected minimum macOS: $minimum_os" >&2; exit 1; }
/usr/bin/file "$app_executable" | /usr/bin/grep -Fq "Mach-O 64-bit executable arm64"

status_json="$("$app_executable" status --json)"
STATUS_JSON="$status_json" node -e 'const value = JSON.parse(process.env.STATUS_JSON); if (value.ok !== true || value.command !== "status" || value.bundleIdentifier !== "com.cubeplus1.echolog.screen-capture" || !["granted", "request-needed"].includes(value.permission)) process.exit(1);'

# Keep the ready-to-run bundle portable: production runtime dependencies stay,
# while pnpm's machine-local install metadata and dev-only toolchain are removed.
CI=1 pnpm install --prod --frozen-lockfile --offline --ignore-scripts
/bin/rm -f node_modules/.modules.yaml node_modules/.pnpm-workspace-state-v1.json
find "$bundle_root" -type d -name '.bin' -prune -exec /bin/rm -rf {} +

node dist/cli/index.js --help >/dev/null
node --check dist/migrate.js
node --check dist/server/app.js

generated_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
server_sha="$(shasum -a 256 dist/server/app.js | awk '{print $1}')"
cli_sha="$(shasum -a 256 dist/cli/index.js | awk '{print $1}')"
app_sha="$(shasum -a 256 "$app_executable" | awk '{print $1}')"
SOURCE_COMMIT="$source_commit" RELEASE_VERSION="$version" GENERATED_AT="$generated_at" SIGNATURE_KIND="$signature_kind" SWIFT_TEST_RESULT="$swift_test_result" SERVER_SHA="$server_sha" CLI_SHA="$cli_sha" APP_SHA="$app_sha" node <<'NODE' > RELEASE-MANIFEST.json
const manifest = {
  schemaVersion: 1,
  product: "EchoLog",
  version: process.env.RELEASE_VERSION,
  sourceCommit: process.env.SOURCE_COMMIT,
  generatedAt: process.env.GENERATED_AT,
  target: { platform: "macOS", architecture: "arm64", minimumVersion: "14.0" },
  readyBundle: {
    sourceIncluded: true,
    compiledArtifactsIncluded: true,
    lockedDependenciesIncluded: true,
    productionDependenciesIncluded: true,
    dependencyScope: "production",
    migrationEntryPoint: "dist/migrate.js",
    configurationIncluded: "config.yaml.example",
  },
  screenCaptureApp: {
    path: "plugins/screen-time/native/macos-capture/build/EchoLogScreenCapture.app",
    bundleIdentifier: "com.cubeplus1.echolog.screen-capture",
    signature: process.env.SIGNATURE_KIND,
    notarized: false,
  },
  sha256: {
    "dist/server/app.js": process.env.SERVER_SHA,
    "dist/cli/index.js": process.env.CLI_SHA,
    "EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture": process.env.APP_SHA,
  },
  verification: [
    "pnpm install --frozen-lockfile",
    "pnpm build",
    "pnpm test",
    "pnpm typecheck",
    "pnpm install --prod --frozen-lockfile --offline --ignore-scripts",
    `swift test: ${process.env.SWIFT_TEST_RESULT}`,
    "codesign --verify --deep --strict",
    "helper status --json contract",
    "portable absolute-path scan",
  ],
  warning: process.env.SIGNATURE_KIND === "adhoc"
    ? "Ad-hoc signed and not notarized; first launch may require manual approval in macOS Privacy & Security."
    : "Developer ID signed; notarization is not performed by this script.",
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
NODE

/bin/rm -rf "$bundle_root/plugins/screen-time/native/macos-capture/.build"
find "$bundle_root" -name '.DS_Store' -delete

temp_root_physical="$(cd "$temp_root" && pwd -P)"
scan_prefixes=("$repo_root/" "$temp_root/" "$temp_root_physical/" "$pnpm_store_path/")
if [[ -n "${HOME:-}" ]]; then
  scan_prefixes+=("$HOME/")
fi
path_scan_output=""
for scan_prefix in "${scan_prefixes[@]}"; do
  matches="$(LC_ALL=C /usr/bin/grep -aR -l -F "$scan_prefix" "$bundle_root" || true)"
  if [[ -n "$matches" ]]; then
    path_scan_output+="${path_scan_output:+$'\n'}$matches"
  fi
done
if [[ -n "$path_scan_output" ]]; then
  echo "release bundle contains machine-local absolute paths:" >&2
  echo "$path_scan_output" >&2
  exit 1
fi

absolute_links="$(find "$bundle_root" -type l -exec /bin/sh -c '
  for link_path do
    link_target="$(readlink "$link_path")"
    case "$link_target" in /*) printf "%s -> %s\n" "$link_path" "$link_target";; esac
  done
' sh {} +)"
if [[ -n "$absolute_links" ]]; then
  echo "release bundle contains absolute symlinks:" >&2
  echo "$absolute_links" >&2
  exit 1
fi

main_archive="$output_dir/${bundle_name}-${archive_suffix}.tar.gz"
app_archive="$output_dir/EchoLogScreenCapture-v${version}-macos-arm64-${archive_suffix}.zip"
manifest_copy="$output_dir/RELEASE-MANIFEST.json"
COPYFILE_DISABLE=1 tar -czf "$main_archive" -C "$temp_root" "$bundle_name"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app_path" "$app_archive"
/bin/cp "$bundle_root/RELEASE-MANIFEST.json" "$manifest_copy"

(
  cd "$output_dir"
  shasum -a 256 "$(basename "$main_archive")" "$(basename "$app_archive")" "$(basename "$manifest_copy")" > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)

echo "release_dir=$output_dir"
echo "source_commit=$source_commit"
echo "main_archive=$main_archive"
echo "app_archive=$app_archive"
echo "manifest=$manifest_copy"
echo "checksums=$output_dir/SHA256SUMS"
