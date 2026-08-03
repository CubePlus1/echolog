import {
  PluginError,
  type PluginContext,
} from "@echolog/plugin-sdk";
import type {
  TmuxAgentConversation,
  TmuxAdapterConfig,
  TmuxPaneStatus,
  TmuxRecoveryEntry,
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

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRfc3339DateTime(value: string): boolean {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i
  );
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] == null ? 0 : Number(match[7]);
  const offsetMinute = match[8] == null ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31, leapYear ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31,
  ];
  return month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth[month - 1]! &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVER_INSTANCE_PATTERN = /^[0-9]{1,10}:[0-9]{1,16}$/;
const MAX_PROCESS_PID = 2_147_483_647;
const CONFIRMED_IDENTITY_SOURCES = new Set([
  "open_session_file",
  "cli_resume_argument",
  "cli_session_id_argument",
]);
const UNKNOWN_IDENTITY_SOURCES = new Set([
  "conflicting_evidence",
  "unavailable",
]);
const V3_TOP_LEVEL_KEYS = new Set([
  "schema_version", "tool_version", "producer", "server_instance_id",
  "report_type", "pre_restart", "generated_at", "host", "thresholds",
  "pane_count", "anomaly_count", "confirmed_conversation_count",
  "unknown_conversation_count", "recovery", "panes",
]);
const V3_PRODUCER_KEYS = new Set(["name", "version"]);
const V3_THRESHOLD_KEYS = new Set(["cpu_percent", "memory_mb"]);
const V3_CONVERSATION_KEYS = new Set([
  "tool", "conversation_id", "conversation_id_status", "conversation_id_kind",
  "identity_source", "source_path", "working_directory", "process_instances",
  "stable_mapping_key", "resume_command", "evidence",
]);
const V3_RECOVERY_KEYS = new Set([
  "tool", "conversation_id", "conversation_id_status", "conversation_id_kind",
  "identity_source", "source_path", "stable_mapping_key", "tmux_target",
  "tmux_session_name", "pane_id", "pane_pid", "process_instances",
  "working_directory", "resume_command",
]);
const V3_PANE_KEYS = new Set([
  "session", "window", "pane", "target", "pid", "command", "path",
  "attached", "selected", "dead", "cpu_percent", "memory_mb",
  "process_count", "tools", "activity", "activity_source", "note",
  "anomalies", "session_id", "session_created", "window_id",
  "server_instance_id", "pane_instance_id", "tmux_target",
  "tmux_session_name", "tmux_window_index", "tmux_window_name",
  "tmux_pane_index", "pane_id", "pane_pid", "working_directory",
  "agent_conversations",
]);

function validProcessInstances(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.keys(value).length > 0 &&
    Object.entries(value).every(([pid, instanceKey]) =>
      /^[1-9][0-9]*$/.test(pid) &&
      Number.isInteger(Number(pid)) && Number(pid) <= MAX_PROCESS_PID &&
      typeof instanceKey === "string" &&
      instanceKey.startsWith(`${pid}:`) &&
      instanceKey.length > pid.length + 1
    );
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function expectedResumeCommand(tool: "codex" | "grok", id: string, cwd: string): string {
  return tool === "codex"
    ? `codex resume -C ${shellQuote(cwd)} ${shellQuote(id)}`
    : `grok --cwd ${shellQuote(cwd)} --resume ${shellQuote(id)}`;
}

function validateConversation(value: unknown): boolean {
  if (!isObject(value) || !hasOnlyKeys(value, V3_CONVERSATION_KEYS)) return false;
  const tool = value.tool;
  const kind = value.conversation_id_kind;
  const status = value.conversation_id_status;
  if (
    (tool !== "codex" && tool !== "grok") ||
    kind !== (tool === "codex" ? "codex_thread_id" : "grok_session_id") ||
    (status !== "confirmed" && status !== "unknown") ||
    typeof value.identity_source !== "string" ||
    (value.source_path !== null && typeof value.source_path !== "string") ||
    (value.working_directory !== null &&
      typeof value.working_directory !== "string") ||
    !validProcessInstances(value.process_instances) ||
    typeof value.evidence !== "string" || value.evidence.length === 0
  ) {
    return false;
  }
  if (status === "confirmed") {
    return typeof value.conversation_id === "string" &&
      UUID_PATTERN.test(value.conversation_id) &&
      CONFIRMED_IDENTITY_SOURCES.has(value.identity_source) &&
      typeof value.stable_mapping_key === "string" &&
      value.stable_mapping_key === `${tool}:${value.conversation_id}` &&
      typeof value.working_directory === "string" &&
      value.working_directory.length > 0 &&
      typeof value.resume_command === "string" &&
      value.resume_command === expectedResumeCommand(
        tool,
        value.conversation_id,
        value.working_directory
      );
  }
  return value.conversation_id === null &&
    UNKNOWN_IDENTITY_SOURCES.has(value.identity_source as string) &&
    value.stable_mapping_key === null &&
    value.resume_command === null;
}

function validateRecoveryEntry(value: unknown): boolean {
  if (!isObject(value) || !hasOnlyKeys(value, V3_RECOVERY_KEYS)) return false;
  const conversation = {
    tool: value.tool,
    conversation_id: value.conversation_id,
    conversation_id_status: value.conversation_id_status,
    conversation_id_kind: value.conversation_id_kind,
    identity_source: value.identity_source,
    source_path: value.source_path,
    working_directory: value.working_directory,
    process_instances: value.process_instances,
    stable_mapping_key: value.stable_mapping_key,
    resume_command: value.resume_command,
    evidence: "recovery projection",
  };
  return validateConversation(conversation) &&
    typeof value.tmux_target === "string" &&
    typeof value.tmux_session_name === "string" &&
    typeof value.pane_id === "string" &&
    Number.isInteger(value.pane_pid) && Number(value.pane_pid) > 0;
}

function projectRecoveryEntry(
  pane: TmuxPaneStatus,
  conversation: TmuxAgentConversation
): TmuxRecoveryEntry {
  return {
    tool: conversation.tool,
    conversation_id: conversation.conversation_id,
    conversation_id_status: conversation.conversation_id_status,
    conversation_id_kind: conversation.conversation_id_kind,
    identity_source: conversation.identity_source,
    source_path: conversation.source_path,
    stable_mapping_key: conversation.stable_mapping_key,
    tmux_target: pane.tmux_target!,
    tmux_session_name: pane.tmux_session_name!,
    pane_id: pane.pane_id!,
    pane_pid: pane.pane_pid!,
    process_instances: conversation.process_instances,
    working_directory: conversation.working_directory,
    resume_command: conversation.resume_command,
  };
}

function recoveryEntryKey(entry: TmuxRecoveryEntry): string {
  return JSON.stringify([
    entry.tool,
    entry.conversation_id,
    entry.conversation_id_status,
    entry.conversation_id_kind,
    entry.identity_source,
    entry.source_path,
    entry.stable_mapping_key,
    entry.tmux_target,
    entry.tmux_session_name,
    entry.pane_id,
    entry.pane_pid,
    Object.entries(entry.process_instances).sort(([left], [right]) =>
      Number(left) - Number(right)
    ),
    entry.working_directory,
    entry.resume_command,
  ]);
}

function validatePane(value: unknown, version: number): value is TmuxPaneStatus {
  if (!isObject(value)) return false;
  if (version >= 3 && !hasOnlyKeys(value, V3_PANE_KEYS)) return false;
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
      !Number.isSafeInteger(value.session_created) ||
      typeof value.window_id !== "string" ||
      typeof value.server_instance_id !== "string" ||
      typeof value.pane_instance_id !== "string")
  ) {
    return false;
  }
  if (
    version >= 3 &&
    (!Number.isInteger(value.pid) || Number(value.pid) < 1 ||
      Number(value.pid) > MAX_PROCESS_PID ||
      !/^%[0-9]{1,10}$/.test(value.pane as string) ||
      Number(value.cpu_percent) < 0 ||
      Number(value.memory_mb) < 0 ||
      !Number.isInteger(value.process_count) || Number(value.process_count) < 0 ||
      typeof value.tmux_target !== "string" ||
      value.tmux_target.length === 0 ||
      typeof value.tmux_session_name !== "string" ||
      !Number.isInteger(value.tmux_window_index) || Number(value.tmux_window_index) < 0 ||
      typeof value.tmux_window_name !== "string" ||
      !Number.isInteger(value.tmux_pane_index) || Number(value.tmux_pane_index) < 0 ||
      typeof value.pane_id !== "string" ||
      !/^%[0-9]{1,10}$/.test(value.pane_id) ||
      !Number.isInteger(value.pane_pid) || Number(value.pane_pid) < 1 ||
      Number(value.pane_pid) > MAX_PROCESS_PID ||
      typeof value.working_directory !== "string" ||
      !/^\$[0-9]{1,10}$/.test(value.session_id as string) ||
      Number(value.session_created) < 1 ||
      !/^@[0-9]{1,10}$/.test(value.window_id as string) ||
      !SERVER_INSTANCE_PATTERN.test(value.server_instance_id as string) ||
      (value.pane_instance_id as string).length === 0 ||
      value.session !== value.tmux_session_name ||
      value.window !== `${value.tmux_window_index}:${value.tmux_window_name}` ||
      value.pane !== value.pane_id ||
      value.target !== value.tmux_target ||
      value.tmux_target !==
        `${value.tmux_session_name}:${value.tmux_window_index}.` +
          `${value.tmux_pane_index}` ||
      value.pid !== value.pane_pid ||
      value.path !== value.working_directory ||
      value.pane_instance_id !==
        `${value.server_instance_id}:${value.session_id}:${value.session_created}:` +
          `${value.window_id}:${value.pane_id}:${value.pane_pid}` ||
      !value.tools.every((tool) => tool === "codex" || tool === "grok") ||
      new Set(value.tools).size !== value.tools.length ||
      !value.anomalies.every((item) => item === "CPU" || item === "MEM" || item === "DEAD") ||
      new Set(value.anomalies).size !== value.anomalies.length ||
      !["active", "inactive", "idle", "dead"].includes(value.activity as string) ||
      !Array.isArray(value.agent_conversations) ||
      !value.agent_conversations.every(validateConversation))
  ) {
    return false;
  }
  if (
    version >= 3 &&
    value.dead === true &&
    Array.isArray(value.agent_conversations) &&
    value.agent_conversations.length > 0
  ) {
    return false;
  }
  if (version >= 3 && Array.isArray(value.agent_conversations)) {
    const conversations = value.agent_conversations as TmuxAgentConversation[];
    const mappedPids = new Set(
      conversations.flatMap((conversation) =>
        Object.keys(conversation.process_instances)
      )
    );
    const conversationTools = new Set(
      conversations.map((conversation) => conversation.tool)
    );
    if (
      Number(value.process_count) < mappedPids.size ||
      [...conversationTools].some(
        (tool) => !(value.tools as string[]).includes(tool)
      )
    ) {
      return false;
    }
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
    if (
      !hasOnlyKeys(parsed, V3_TOP_LEVEL_KEYS) ||
      !isObject(parsed.producer) ||
      !hasOnlyKeys(parsed.producer, V3_PRODUCER_KEYS) ||
      !isObject(parsed.thresholds) ||
      !hasOnlyKeys(parsed.thresholds, V3_THRESHOLD_KEYS) ||
      typeof parsed.generated_at !== "string" ||
      !isRfc3339DateTime(parsed.generated_at) ||
      Number(parsed.thresholds.cpu_percent) < 0 ||
      Number(parsed.thresholds.memory_mb) < 0 ||
      Number(parsed.pane_count) < 0 ||
      Number(parsed.anomaly_count) < 0
    ) {
      throw invalidOutput("tmux-status v3 contains undeclared or invalid fields");
    }
    const panes = parsed.panes as unknown as TmuxPaneStatus[];
    const conversations = panes.flatMap((pane) => pane.agent_conversations!);
    const paneIds = new Set<string>();
    const paneInstanceIds = new Set<string>();
    const paneIdentitiesAreUnique = panes.every((pane) => {
      if (
        paneIds.has(pane.pane_id!) ||
        paneInstanceIds.has(pane.pane_instance_id!)
      ) {
        return false;
      }
      paneIds.add(pane.pane_id!);
      paneInstanceIds.add(pane.pane_instance_id!);
      return true;
    });
    const confirmedMappingsAreUnique = panes.every((pane) => {
      const confirmedMappings = new Set<string>();
      return pane.agent_conversations!.every((conversation) => {
        if (conversation.conversation_id_status !== "confirmed") return true;
        const mapping =
          `${conversation.tool}\0${conversation.conversation_id!.toLowerCase()}`;
        if (confirmedMappings.has(mapping)) return false;
        confirmedMappings.add(mapping);
        return true;
      });
    });
    const processInstances = new Set<string>();
    const processInstanceByPid = new Map<string, string>();
    const processInstancesAreUnique = conversations.every((conversation) =>
      Object.entries(conversation.process_instances).every(([pid, instanceKey]) => {
        const identity = `${pid}\0${instanceKey}`;
        const priorInstanceKey = processInstanceByPid.get(pid);
        if (
          processInstances.has(identity) ||
          (priorInstanceKey !== undefined && priorInstanceKey !== instanceKey)
        ) {
          return false;
        }
        processInstances.add(identity);
        processInstanceByPid.set(pid, instanceKey);
        return true;
      })
    );
    const anomalousPanes = panes.filter(
      (pane) => pane.anomalies.length > 0
    ).length;
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
      !paneIdentitiesAreUnique ||
      !confirmedMappingsAreUnique ||
      !processInstancesAreUnique ||
      parsed.anomaly_count !== anomalousPanes ||
      typeof parsed.tool_version !== "string" ||
      !/^0\.3\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(parsed.tool_version) ||
      typeof parsed.host !== "string" || parsed.host.length === 0 ||
      !Number.isInteger(parsed.confirmed_conversation_count) ||
      Number(parsed.confirmed_conversation_count) < 0 ||
      parsed.confirmed_conversation_count !== confirmed ||
      !Number.isInteger(parsed.unknown_conversation_count) ||
      Number(parsed.unknown_conversation_count) < 0 ||
      parsed.unknown_conversation_count !== unknown ||
      !Array.isArray(parsed.recovery) ||
      parsed.recovery.length !== conversations.length ||
      !parsed.recovery.every(validateRecoveryEntry)
    ) {
      throw invalidOutput("tmux-status v3 conversation metadata is invalid");
    }
    const expectedRecovery = panes.flatMap((pane) =>
      pane.agent_conversations!.map((conversation) =>
        recoveryEntryKey(projectRecoveryEntry(pane, conversation))
      )
    );
    const actualRecovery = (parsed.recovery as unknown as TmuxRecoveryEntry[])
      .map(recoveryEntryKey);
    if (expectedRecovery.some((entry, index) => entry !== actualRecovery[index])) {
      throw invalidOutput("tmux-status v3 recovery projection is inconsistent");
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
