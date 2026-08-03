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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (item) => Number.isInteger(item) && item > 0
  );
}

function validateConversation(value: unknown): boolean {
  if (!isObject(value)) return false;
  const tool = value.tool;
  const kind = value.conversation_id_kind;
  const status = value.conversation_id_status;
  if (
    (tool !== "codex" && tool !== "grok") ||
    kind !== (tool === "codex" ? "codex_thread_id" : "grok_session_id") ||
    (status !== "confirmed" && status !== "unknown") ||
    typeof value.identity_source !== "string" ||
    (value.source_path !== null && typeof value.source_path !== "string") ||
    !positiveIntegerArray(value.process_pids) ||
    typeof value.evidence !== "string" || value.evidence.length === 0
  ) {
    return false;
  }
  if (status === "confirmed") {
    return typeof value.conversation_id === "string" &&
      UUID_PATTERN.test(value.conversation_id) &&
      value.stable_mapping_key === `${tool}:${value.conversation_id}` &&
      typeof value.resume_command === "string" &&
      value.resume_command.length > 0;
  }
  return value.conversation_id === null &&
    value.stable_mapping_key === null &&
    value.resume_command === null;
}

function validateRecoveryEntry(value: unknown): boolean {
  if (!isObject(value)) return false;
  const conversation = {
    ...value,
    process_pids: value.process_pids,
    evidence: "recovery projection",
  };
  return validateConversation(conversation) &&
    typeof value.tmux_target === "string" &&
    typeof value.tmux_session_name === "string" &&
    typeof value.pane_id === "string" &&
    Number.isInteger(value.pane_pid) && Number(value.pane_pid) > 0 &&
    typeof value.working_directory === "string";
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
  if (
    version >= 3 &&
    (typeof value.tmux_target !== "string" ||
      value.tmux_target !== value.target ||
      typeof value.tmux_session_name !== "string" ||
      value.tmux_session_name !== value.session ||
      !Number.isInteger(value.tmux_window_index) ||
      typeof value.tmux_window_name !== "string" ||
      !Number.isInteger(value.tmux_pane_index) ||
      typeof value.pane_id !== "string" ||
      value.pane_id !== value.pane ||
      !Number.isInteger(value.pane_pid) ||
      value.pane_pid !== value.pid ||
      typeof value.working_directory !== "string" ||
      value.working_directory !== value.path ||
      !Array.isArray(value.agent_conversations) ||
      !value.agent_conversations.every(validateConversation))
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
  if (version !== 1 && version !== 2 && version !== 3) {
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
    throw invalidOutput(`tmux-status v${version} producer metadata is invalid`);
  }
  if (version === 3) {
    const conversations = parsed.panes.flatMap((pane) =>
      (pane as Record<string, unknown>).agent_conversations as unknown[]
    );
    const confirmed = conversations.filter((value) =>
      isObject(value) && value.conversation_id_status === "confirmed"
    ).length;
    const unknown = conversations.filter((value) =>
      isObject(value) && value.conversation_id_status === "unknown"
    ).length;
    if (
      (parsed.report_type !== "status" &&
        parsed.report_type !== "snapshot" &&
        parsed.report_type !== "recovery") ||
      typeof parsed.pre_restart !== "boolean" ||
      parsed.pre_restart !== (parsed.report_type === "recovery") ||
      typeof parsed.host !== "string" || parsed.host.length === 0 ||
      !Number.isInteger(parsed.confirmed_conversation_count) ||
      parsed.confirmed_conversation_count !== confirmed ||
      !Number.isInteger(parsed.unknown_conversation_count) ||
      parsed.unknown_conversation_count !== unknown ||
      !Array.isArray(parsed.recovery) ||
      parsed.recovery.length !== conversations.length ||
      !parsed.recovery.every(validateRecoveryEntry)
    ) {
      throw invalidOutput("tmux-status v3 conversation metadata is invalid");
    }
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

function readSupportedVersion(output: string): string | null {
  const match = output
    .trim()
    .match(/^(?:tmux-status\s+)?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && (minor === 1 || minor === 2 || minor === 3)
    ? `${match[1]}.${match[2]}.${match[3]}`
    : null;
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
    const checks = [];
    try {
      const result = await this.context.exec({
        executable: this.config.executable,
        args: ["--version"],
        timeoutMs: this.config.timeoutMs,
      });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          checks: [{
            id: "executable",
            ok: false,
            message: result.stderr.trim() || `exit ${result.exitCode}`,
          }],
        };
      }

      const versionOutput = result.stdout.trim() || result.stderr.trim();
      checks.push({
        id: "executable",
        ok: true,
        message: versionOutput || "tmux-status is available",
      });
      const version = readSupportedVersion(versionOutput);
      checks.push({
        id: "version",
        ok: version !== null,
        message: version
          ? `tmux-status ${version} is supported`
          : `Unsupported tmux-status version: ${versionOutput || "unknown"}`,
      });
      if (!version) return { ok: false, checks };

      try {
        const snapshot = await this.status();
        checks.push({
          id: "status-contract",
          ok: true,
          message: `schema v${snapshot.schema_version ?? 1} status output is valid`,
        });
      } catch (error) {
        const mapped = error instanceof PluginError ? error : executionError(error);
        checks.push({
          id: "status-contract",
          ok: false,
          message: mapped.message,
          details: { code: mapped.code },
        });
      }
      return { ok: checks.every((check) => check.ok), checks };
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
