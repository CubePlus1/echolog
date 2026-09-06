import {
  chmod,
  lstat,
  mkdtemp,
  open as openFile,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  PluginCommandRequest,
  PluginCommandResult,
  PluginDoctorCheck,
} from "@echolog/plugin-sdk";
import {
  checkMacosHelperInstall,
  resolveMacosHelperExecutable,
  resolveMacosHelperApp,
} from "./macos-helper.js";

const HELPER_BUNDLE_ID = "com.cubeplus1.echolog.screen-capture";
const CAPTURE_TIMEOUT_MS = 15_000;
const HELPER_MAX_OUTPUT_BYTES = 65_536;
const MAX_PIXEL_EDGE = 2_560;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const LAUNCH_SERVICES_EXECUTABLE = "/usr/bin/open";

export type CaptureCommandAdapter = (
  request: PluginCommandRequest,
  signal?: AbortSignal
) => Promise<PluginCommandResult>;

export type CaptureErrorCode =
  | "CAPTURE_PERMISSION_REQUIRED"
  | "CAPTURE_SOURCE_UNAVAILABLE"
  | "CAPTURE_UNSUPPORTED_OS"
  | "CAPTURE_FAILED"
  | "CAPTURE_BUSY"
  | "CAPTURE_OUTPUT_FAILED"
  | "PLUGIN_EXEC_FAILED"
  | "PLUGIN_OUTPUT_INVALID"
  | "PLUGIN_TIMEOUT";

export class CaptureError extends Error {
  constructor(
    public readonly code: CaptureErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

export interface CaptureTestResult {
  format: "png";
  displayId: number;
  widthPixels: number;
  heightPixels: number;
  bytes: number;
  capturedAt: string;
  preview: {
    mediaType: "image/png";
    base64: string;
  };
}

export interface CapturedPng {
  format: "png";
  displayId: number;
  widthPixels: number;
  heightPixels: number;
  bytes: number;
  capturedAt: string;
  png: Buffer;
}

interface CaptureSuccess {
  ok: true;
  command: "capture";
  path: string;
  format: "png";
  displayId: number;
  widthPixels: number;
  heightPixels: number;
  bytes: number;
  capturedAt: string;
}

function isTimeout(error: unknown): boolean {
  const value = error as {
    name?: unknown;
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  return value?.name === "AbortError" ||
    value?.code === "ABORT_ERR" ||
    value?.code === "ETIMEDOUT" ||
    (value?.killed === true && value?.signal !== undefined);
}

function safeCommandFailure(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error;
  if (isTimeout(error)) {
    return new CaptureError("PLUGIN_TIMEOUT", "Screen capture helper timed out", 504);
  }
  return new CaptureError("PLUGIN_EXEC_FAILED", "Screen capture helper is unavailable", 502);
}

function parseObject(stdout: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned invalid output", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned invalid output", 502);
  }
  return value as Record<string, unknown>;
}

function parseFailure(result: PluginCommandResult): never {
  const value = parseObject(result.stdout);
  if (
    value.ok !== false ||
    typeof value.code !== "string" ||
    typeof value.error !== "string" ||
    typeof value.retryable !== "boolean"
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned invalid output", 502);
  }
  switch (value.code) {
    case "CAPTURE_PERMISSION_REQUIRED":
      throw new CaptureError(
        "CAPTURE_PERMISSION_REQUIRED",
        "Screen Recording permission is required; grant it to EchoLog Screen Capture in System Settings",
        409
      );
    case "CAPTURE_SOURCE_UNAVAILABLE":
      throw new CaptureError("CAPTURE_SOURCE_UNAVAILABLE", "No screen capture source is available", 503);
    case "CAPTURE_UNSUPPORTED_OS":
      throw new CaptureError("CAPTURE_UNSUPPORTED_OS", "Screen capture requires macOS 14 or later", 503);
    case "CAPTURE_FAILED":
      throw new CaptureError("CAPTURE_FAILED", "Screen capture failed", 502);
    case "CAPTURE_OUTPUT_FAILED":
      throw new CaptureError("CAPTURE_OUTPUT_FAILED", "Screen capture output could not be created", 502);
    default:
      throw new CaptureError("PLUGIN_EXEC_FAILED", "Screen capture helper failed", 502);
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index]);
}

function parseCaptureSuccess(result: PluginCommandResult, outputPath: string): CaptureSuccess {
  if (result.exitCode !== 0) parseFailure(result);
  const value = parseObject(result.stdout);
  const expectedKeys = [
    "bytes", "capturedAt", "command", "displayId", "format",
    "heightPixels", "ok", "path", "widthPixels",
  ];
  if (
    !exactKeys(value, expectedKeys) ||
    value.ok !== true ||
    value.command !== "capture" ||
    value.path !== outputPath ||
    value.format !== "png" ||
    !Number.isInteger(value.displayId) || Number(value.displayId) < 0 ||
    !Number.isInteger(value.widthPixels) || Number(value.widthPixels) < 1 ||
    !Number.isInteger(value.heightPixels) || Number(value.heightPixels) < 1 ||
    Math.max(Number(value.widthPixels), Number(value.heightPixels)) > MAX_PIXEL_EDGE ||
    !Number.isInteger(value.bytes) || Number(value.bytes) < PNG_SIGNATURE.length ||
    Number(value.bytes) > MAX_CAPTURE_BYTES ||
    typeof value.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(value.capturedAt))
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned invalid output", 502);
  }
  return value as unknown as CaptureSuccess;
}

async function readPrivateHelperFile(
  path: string,
  directory: string,
  allowEmpty: boolean
): Promise<Buffer> {
  const linkInfo = await lstat(path).catch(() => null);
  if (!linkInfo?.isFile() || linkInfo.isSymbolicLink()) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper did not create a valid result file", 502);
  }
  const canonical = await realpath(path);
  const fileInfo = await stat(path);
  if (
    canonical !== path ||
    dirname(canonical) !== directory ||
    (fileInfo.mode & 0o777) !== 0o600 ||
    fileInfo.size > HELPER_MAX_OUTPUT_BYTES ||
    (!allowEmpty && fileInfo.size === 0)
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned an invalid result file", 502);
  }
  const contents = await readFile(path);
  if (
    contents.length !== fileInfo.size ||
    contents.length > HELPER_MAX_OUTPUT_BYTES ||
    (!allowEmpty && contents.length === 0)
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned an invalid result file", 502);
  }
  return contents;
}

async function waitForLaunchResultFiles(
  resultPath: string,
  stderrPath: string,
  deadlineMs: number,
  signal?: AbortSignal
): Promise<void> {
  let previousResultSignature: string | null = null;
  while (Date.now() < deadlineMs) {
    if (signal?.aborted) {
      throw Object.assign(new Error("Screen capture helper aborted"), {
        name: "AbortError",
        code: "ABORT_ERR",
      });
    }
    const [resultInfo, stderrInfo] = await Promise.all([
      lstat(resultPath).catch(() => null),
      lstat(stderrPath).catch(() => null),
    ]);
    if (
      resultInfo?.isFile() &&
      !resultInfo.isSymbolicLink() &&
      resultInfo.size > 0 &&
      stderrInfo?.isFile() &&
      !stderrInfo.isSymbolicLink()
    ) {
      const signature = [
        resultInfo.dev,
        resultInfo.ino,
        resultInfo.size,
        resultInfo.mtimeMs,
      ].join(":");
      if (signature === previousResultSignature) return;
      previousResultSignature = signature;
    } else {
      previousResultSignature = null;
    }
    await delay(Math.min(25, Math.max(1, deadlineMs - Date.now())), undefined, {
      signal,
    });
  }
  throw new CaptureError("PLUGIN_TIMEOUT", "Screen capture helper timed out", 504);
}

async function createPrivateOutputFile(path: string): Promise<void> {
  const handle = await openFile(path, "wx", 0o600);
  await handle.close();
}

async function validatePng(
  outputPath: string,
  reportedBytes: number,
  widthPixels: number,
  heightPixels: number
): Promise<Buffer> {
  const linkInfo = await lstat(outputPath).catch(() => null);
  if (!linkInfo?.isFile() || linkInfo.isSymbolicLink()) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper did not create a regular PNG", 502);
  }
  const fileInfo = await stat(outputPath);
  if (
    fileInfo.size !== reportedBytes ||
    fileInfo.size > MAX_CAPTURE_BYTES ||
    (fileInfo.mode & 0o777) !== 0o600
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned an invalid PNG size", 502);
  }
  const canonical = await realpath(outputPath);
  if (canonical !== outputPath || dirname(canonical) !== dirname(outputPath)) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned an unsafe path", 502);
  }
  const png = await readFile(outputPath);
  if (
    png.length !== reportedBytes ||
    png.length < 24 ||
    !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    png.subarray(12, 16).toString("ascii") !== "IHDR" ||
    png.readUInt32BE(16) !== widthPixels ||
    png.readUInt32BE(20) !== heightPixels
  ) {
    throw new CaptureError("PLUGIN_OUTPUT_INVALID", "Screen capture helper returned an invalid PNG", 502);
  }
  return png;
}

export class MacScreenCaptureService {
  private readonly executable: string;
  private readonly appBundle: string;
  private captureInFlight = false;

  constructor(
    private readonly exec: CaptureCommandAdapter,
    executableOverride?: string
  ) {
    this.executable = resolveMacosHelperExecutable(executableOverride);
    this.appBundle = resolveMacosHelperApp(this.executable);
  }

  private async invokeViaLaunchServices(
    directory: string,
    helperArguments: string[],
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<PluginCommandResult> {
    const check = checkMacosHelperInstall(this.executable);
    if (!check.ok) {
      throw new CaptureError("PLUGIN_EXEC_FAILED", check.message, 502);
    }
    const resultPath = resolve(directory, "helper-result.json");
    const stderrPath = resolve(directory, "helper-stderr.log");
    const deadlineMs = Date.now() + timeoutMs;
    await Promise.all([
      createPrivateOutputFile(resultPath),
      createPrivateOutputFile(stderrPath),
    ]);
    try {
      await this.exec({
        executable: LAUNCH_SERVICES_EXECUTABLE,
        args: [
          "-W", "-n",
          "-o", resultPath,
          "--stderr", stderrPath,
          this.appBundle,
          "--args",
          ...helperArguments,
        ],
        timeoutMs,
        maxBufferBytes: HELPER_MAX_OUTPUT_BYTES,
      }, signal);
    } catch (error) {
      throw safeCommandFailure(error);
    }

    // `open` can emit benign diagnostics even when the app completed. The app's
    // private result file is the only helper protocol channel we trust or parse.
    await waitForLaunchResultFiles(resultPath, stderrPath, deadlineMs, signal)
      .catch((error) => { throw safeCommandFailure(error); });
    const [resultBytes] = await Promise.all([
      readPrivateHelperFile(resultPath, directory, false),
      readPrivateHelperFile(stderrPath, directory, true),
    ]);
    const stdout = resultBytes.toString("utf8");
    const envelope = parseObject(stdout);
    return {
      stdout,
      stderr: "",
      exitCode: envelope.ok === true ? 0 : 1,
    };
  }

  private async capturePng(signal?: AbortSignal): Promise<CapturedPng> {
    if (this.captureInFlight) {
      throw new CaptureError("CAPTURE_BUSY", "A screen capture operation is already running", 409);
    }
    this.captureInFlight = true;
    let createdDirectory: string | null = null;
    try {
      createdDirectory = await mkdtemp(join(tmpdir(), "echolog-screen-understanding-"));
      const temporaryDirectory = await realpath(createdDirectory);
      await chmod(temporaryDirectory, 0o700);
      const outputPath = resolve(temporaryDirectory, "capture.png");
      const result = await this.invokeViaLaunchServices(
        temporaryDirectory,
        [
          "capture", "--display", "active", "--output", outputPath,
          "--max-pixel-edge", String(MAX_PIXEL_EDGE), "--json",
        ],
        CAPTURE_TIMEOUT_MS,
        signal
      );
      const parsed = parseCaptureSuccess(result, outputPath);
      const png = await validatePng(
        outputPath,
        parsed.bytes,
        parsed.widthPixels,
        parsed.heightPixels
      );
      return {
        format: "png",
        displayId: parsed.displayId,
        widthPixels: parsed.widthPixels,
        heightPixels: parsed.heightPixels,
        bytes: parsed.bytes,
        capturedAt: parsed.capturedAt,
        png,
      };
    } catch (error) {
      throw safeCommandFailure(error);
    } finally {
      try {
        if (createdDirectory) {
          await rm(createdDirectory, { recursive: true, force: true });
        }
      } finally {
        this.captureInFlight = false;
      }
    }
  }

  async captureForInference(signal?: AbortSignal): Promise<CapturedPng> {
    return this.capturePng(signal);
  }

  async captureTest(signal?: AbortSignal): Promise<CaptureTestResult> {
    const captured = await this.capturePng(signal);
    return {
      format: captured.format,
      displayId: captured.displayId,
      widthPixels: captured.widthPixels,
      heightPixels: captured.heightPixels,
      bytes: captured.bytes,
      capturedAt: captured.capturedAt,
      preview: { mediaType: "image/png", base64: captured.png.toString("base64") },
    };
  }

  async doctor(signal?: AbortSignal): Promise<PluginDoctorCheck[]> {
    let createdDirectory: string | null = null;
    try {
      const install = checkMacosHelperInstall(this.executable);
      if (!install.ok) {
        return [{
          id: "screen-understanding:helper",
          ok: false,
          message: install.message,
          details: {
            appBundle: install.appBundle,
            executable: install.executable,
            buildCommand: install.buildCommand,
            launchMethod: "LaunchServices",
          },
        }];
      }
      createdDirectory = await mkdtemp(join(tmpdir(), "echolog-screen-understanding-"));
      const temporaryDirectory = await realpath(createdDirectory);
      await chmod(temporaryDirectory, 0o700);
      const result = await this.invokeViaLaunchServices(
        temporaryDirectory,
        ["doctor", "--json"],
        5_000,
        signal
      );
      if (result.exitCode !== 0) throw new Error("helper doctor failed");
      const value = parseObject(result.stdout);
      const expected = [
        "bundleIdentifier", "command", "helperVersion", "keychainAvailable",
        "ok", "osSupported", "screenRecordingPermission",
      ];
      if (
        !exactKeys(value, expected) ||
        value.ok !== true ||
        value.command !== "doctor" ||
        value.bundleIdentifier !== HELPER_BUNDLE_ID ||
        typeof value.helperVersion !== "string" ||
        typeof value.osSupported !== "boolean" ||
        typeof value.keychainAvailable !== "boolean" ||
        !["granted", "request-needed"].includes(String(value.screenRecordingPermission))
      ) throw new Error("helper doctor output invalid");
      const permissionGranted = value.screenRecordingPermission === "granted";
      return [{
        id: "screen-understanding:helper",
        ok: value.osSupported === true && value.keychainAvailable === true,
        message: `screen capture helper ${value.helperVersion} is available`,
        details: {
          appBundle: this.appBundle,
          launchMethod: "LaunchServices",
          bundleIdentifier: HELPER_BUNDLE_ID,
        },
      }, {
        id: "screen-understanding:permission",
        ok: true,
        message: permissionGranted
          ? "Screen Recording permission is granted"
          : "Screen Recording permission is not granted; foreground tracking remains available",
        details: { granted: permissionGranted, actionable: !permissionGranted },
      }];
    } catch {
      return [{
        id: "screen-understanding:helper",
        ok: false,
        message: "screen capture helper is unavailable or invalid",
        details: { appBundle: this.appBundle, launchMethod: "LaunchServices" },
      }];
    } finally {
      if (createdDirectory) {
        await rm(createdDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }
}
