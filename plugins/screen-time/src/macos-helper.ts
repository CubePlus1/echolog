import { constants, accessSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const INNER_EXECUTABLE =
  "../native/macos-capture/build/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture";
export const MACOS_HELPER_BUILD_COMMAND =
  "ECHOLOG_MACOS_ADHOC_SMOKE=1 pnpm build:macos-capture";

export const DEFAULT_MACOS_HELPER_EXECUTABLE = fileURLToPath(
  new URL(INNER_EXECUTABLE, import.meta.url)
);

export interface MacosHelperInstallCheck {
  ok: boolean;
  appBundle: string;
  executable: string;
  buildCommand: string;
  message: string;
}

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

export function checkMacosHelperInstall(override?: unknown): MacosHelperInstallCheck {
  const error = validateMacosHelperExecutableOverride(override);
  const executable = error
    ? typeof override === "string"
      ? override
      : DEFAULT_MACOS_HELPER_EXECUTABLE
    : resolveMacosHelperExecutable(override);
  const appBundle = dirname(dirname(dirname(executable)));
  const base = { appBundle, executable, buildCommand: MACOS_HELPER_BUILD_COMMAND };
  if (error) {
    return { ...base, ok: false, message: error };
  }
  try {
    if (!statSync(appBundle).isDirectory()) {
      return {
        ...base,
        ok: false,
        message: `EchoLogScreenCapture.app is not a directory at ${appBundle}; run ${MACOS_HELPER_BUILD_COMMAND}`,
      };
    }
  } catch {
    return {
      ...base,
      ok: false,
      message: `EchoLogScreenCapture.app is missing at ${appBundle}; run ${MACOS_HELPER_BUILD_COMMAND}`,
    };
  }
  try {
    if (!statSync(executable).isFile()) {
      return {
        ...base,
        ok: false,
        message: `screen capture helper executable is not a file at ${executable}; run ${MACOS_HELPER_BUILD_COMMAND}`,
      };
    }
    accessSync(executable, constants.X_OK);
  } catch {
    return {
      ...base,
      ok: false,
      message: `screen capture helper executable is not runnable at ${executable}; run ${MACOS_HELPER_BUILD_COMMAND}`,
    };
  }
  return {
    ...base,
    ok: true,
    message: `EchoLogScreenCapture.app is installed at ${appBundle}`,
  };
}
