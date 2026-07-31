import {
  PluginError,
  type PluginContext,
} from "@echolog/plugin-sdk";
import type {
  TmuxAdapterConfig,
  TmuxPaneStatus,
  TmuxStatusPayload,
} from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validatePane(value: unknown, version: number): value is TmuxPaneStatus {
  if (!isObject(value)) return false;
  const requiredStrings = [
    "session",
    "window",
    "pane",
    "target",
    "command",
    "path",
    "activity",
    "activity_source",
    "note",
  ];
  const requiredBooleans = ["attached", "selected", "dead"];
  const requiredNumbers = [
    "pid",
    "cpu_percent",
    "memory_mb",
    "process_count",
  ];
  if (requiredStrings.some((key) => typeof value[key] !== "string")) return false;
  if (requiredBooleans.some((key) => typeof value[key] !== "boolean")) return false;
  if (requiredNumbers.some((key) => !isFiniteNumber(value[key]))) return false;
  if (!stringArray(value.tools) || !stringArray(value.anomalies)) return false;
  if (
    version >= 2 &&
    (typeof value.session_id !== "string" ||
      !Number.isInteger(value.session_created) ||
      typeof value.window_id !== "string" ||
      typeof value.server_instance_id !== "string" ||
      typeof value.pane_instance_id !== "string")
  ) {
    return false;
  }
  return true;
}

export function parseStatusPayload(stdout: string): TmuxStatusPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new PluginError(
      "PLUGIN_OUTPUT_INVALID",
      "tmux-status output is not valid JSON",
      "tmux-status",
      "ready",
      502,
      { cause: error }
    );
  }
  if (!isObject(parsed)) {
    throw invalidOutput("tmux-status output must be an object");
  }
  const version = parsed.schema_version == null ? 1 : parsed.schema_version;
  if (version !== 1 && version !== 2) {
    throw invalidOutput(`Unsupported tmux-status schema_version: ${String(version)}`);
  }
  if (
    typeof parsed.generated_at !== "string" ||
    Number.isNaN(Date.parse(parsed.generated_at)) ||
    !isObject(parsed.thresholds) ||
    !isFiniteNumber(parsed.thresholds.cpu_percent) ||
    !isFiniteNumber(parsed.thresholds.memory_mb) ||
    !Number.isInteger(parsed.pane_count) ||
    !Number.isInteger(parsed.anomaly_count) ||
    !Array.isArray(parsed.panes) ||
    parsed.panes.length !== parsed.pane_count ||
    !parsed.panes.every((pane) => validatePane(pane, version))
  ) {
    throw invalidOutput("tmux-status output does not match the JSON contract");
  }
  if (
    version >= 2 &&
    (typeof parsed.tool_version !== "string" ||
      (parsed.server_instance_id !== null &&
        typeof parsed.server_instance_id !== "string") ||
      !isObject(parsed.producer) ||
      parsed.producer.name !== "tmux-status" ||
      typeof parsed.producer.version !== "string" ||
      parsed.producer.version !== parsed.tool_version ||
      (parsed.panes.length === 0
        ? parsed.server_instance_id !== null
        : typeof parsed.server_instance_id !== "string" ||
          !parsed.panes.every(
            (pane) => pane.server_instance_id === parsed.server_instance_id
          )))
  ) {
    throw invalidOutput("tmux-status v2 producer metadata is invalid");
  }
  return parsed as unknown as TmuxStatusPayload;
}

function invalidOutput(message: string): PluginError {
  return new PluginError(
    "PLUGIN_OUTPUT_INVALID",
    message,
    "tmux-status",
    "ready",
    502
  );
}

function executionError(error: unknown): PluginError {
  const value = error as {
    code?: string;
    name?: string;
    message?: string;
    killed?: boolean;
    signal?: string;
  };
  if (
    value?.name === "AbortError" ||
    value?.code === "ETIMEDOUT" ||
    (value?.killed === true && value?.signal === "SIGTERM")
  ) {
    return new PluginError(
      "PLUGIN_TIMEOUT",
      "tmux-status command timed out",
      "tmux-status",
      "ready",
      504,
      { cause: error }
    );
  }
  if (value?.code === "ENOENT") {
    return new PluginError(
      "PLUGIN_DEPENDENCY_MISSING",
      "tmux-status executable was not found",
      "tmux-status",
      "ready",
      503,
      { cause: error }
    );
  }
  return new PluginError(
    "PLUGIN_EXEC_FAILED",
    value?.message ?? "tmux-status command failed",
    "tmux-status",
    "ready",
    502,
    { cause: error }
  );
}

export class TmuxStatusAdapter {
  constructor(
    private readonly context: PluginContext,
    readonly config: TmuxAdapterConfig
  ) {}

  async status(signal?: AbortSignal): Promise<TmuxStatusPayload> {
    let result;
    try {
      result = await this.context.exec(
        {
          executable: this.config.executable,
          args: [
            "status",
            "--json",
            "--cpu-threshold",
            String(this.config.cpuThreshold),
            "--memory-threshold",
            String(this.config.memoryThresholdMb),
          ],
          timeoutMs: this.config.timeoutMs,
        },
        signal
      );
    } catch (error) {
      throw executionError(error);
    }
    if (result.exitCode !== 0) {
      throw new PluginError(
        "PLUGIN_EXEC_FAILED",
        result.stderr.trim() || `tmux-status exited with ${result.exitCode}`,
        "tmux-status",
        "ready",
        502
      );
    }
    return parseStatusPayload(result.stdout);
  }

  async mark(
    target: string,
    state: "active" | "inactive" | "auto",
    note = "",
    signal?: AbortSignal
  ) {
    let result;
    try {
      result = await this.context.exec(
        {
          executable: this.config.executable,
          args: [
            "mark",
            target,
            state,
            ...(note ? ["--note", note] : []),
          ],
          timeoutMs: this.config.timeoutMs,
        },
        signal
      );
    } catch (error) {
      throw executionError(error);
    }
    if (result.exitCode !== 0) {
      throw new PluginError(
        "PLUGIN_EXEC_FAILED",
        result.stderr.trim() || `tmux-status exited with ${result.exitCode}`,
        "tmux-status",
        "ready",
        502
      );
    }
    return { target, state, note, message: result.stdout.trim() };
  }

  async doctor() {
    try {
      const result = await this.context.exec({
        executable: this.config.executable,
        args: ["--version"],
        timeoutMs: this.config.timeoutMs,
      });
      return {
        ok: result.exitCode === 0,
        checks: [{
          id: "executable",
          ok: result.exitCode === 0,
          message:
            result.exitCode === 0
              ? result.stdout.trim() || "tmux-status is available"
              : result.stderr.trim() || `exit ${result.exitCode}`,
        }],
      };
    } catch (error) {
      const mapped = executionError(error);
      return {
        ok: false,
        checks: [{
          id: "executable",
          ok: false,
          message: mapped.message,
          details: { code: mapped.code },
        }],
      };
    }
  }
}
