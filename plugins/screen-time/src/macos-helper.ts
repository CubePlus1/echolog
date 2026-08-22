import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const INNER_EXECUTABLE =
  "../native/macos-capture/build/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture";

export const DEFAULT_MACOS_HELPER_EXECUTABLE = fileURLToPath(
  new URL(INNER_EXECUTABLE, import.meta.url)
);

export function validateMacosHelperExecutableOverride(
  value: unknown
): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    !value.endsWith(
      "/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture"
    )
  ) {
    return "macos_helper_path must be an absolute EchoLogScreenCapture.app inner executable path";
  }
  return null;
}

export function resolveMacosHelperExecutable(override?: unknown): string {
  const error = validateMacosHelperExecutableOverride(override);
  if (error) throw new Error(error);
  return typeof override === "string"
    ? override
    : DEFAULT_MACOS_HELPER_EXECUTABLE;
}

export function resolveMacosHelperApp(override?: unknown): string {
  const executable = resolveMacosHelperExecutable(override);
  return dirname(dirname(dirname(executable)));
}
