import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PluginError,
  type PluginContext,
} from "@echolog/plugin-sdk";
import {
  parseStatusPayload,
  TmuxStatusAdapter,
} from "../plugins/tmux-status/src/adapter.js";
import {
  conversationObservationKey,
  paneIdentity,
  persistenceTimestamp,
  persistableConversations,
  sessionKey,
} from "../plugins/tmux-status/src/store.js";
import { tmuxStatusPlugin } from "../plugins/tmux-status/src/index.js";
import { tmuxAgentConversations } from "../plugins/tmux-status/src/schema.js";
import type {
  TmuxPaneStatus,
  TmuxStatusPayload,
} from "../plugins/tmux-status/src/types.js";

function pane(overrides: Partial<TmuxPaneStatus> = {}): TmuxPaneStatus {
  return {
    session: "work",
    window: "0:code",
    pane: "%3",
    target: "work:0.0",
    pid: 100,
    command: "node",
    path: "/tmp/project",
    attached: true,
    selected: true,
    dead: false,
    cpu_percent: 12.5,
    memory_mb: 256,
    process_count: 3,
    tools: ["codex"],
    activity: "active",
    activity_source: "auto",
    note: "",
    anomalies: [],
    session_id: "$1",
    session_created: 1_785_000_000,
    window_id: "@2",
    server_instance_id: "500:1784999999",
    pane_instance_id: "500:1784999999:$1:1785000000:@2:%3:100",
    ...overrides,
  };
}

function payload(overrides: Partial<TmuxStatusPayload> = {}): TmuxStatusPayload {
  return {
    schema_version: 2,
    tool_version: "0.2.0",
    server_instance_id: "500:1784999999",
    producer: { name: "tmux-status", version: "0.2.0" },
    generated_at: "2026-07-31T02:00:00Z",
    thresholds: { cpu_percent: 80, memory_mb: 1_024 },
    pane_count: 1,
    anomaly_count: 0,
    panes: [pane()],
    ...overrides,
  };
}

function contractFixture(directory: "fixtures" | "fixtures-invalid", name: string) {
  return readFileSync(
    new URL(`../contracts/tmux-status/v3/${directory}/${name}.json`, import.meta.url),
    "utf8"
  );
}

function context(
  exec: PluginContext["exec"]
): PluginContext {
  return {
    pluginId: "tmux-status",
    config: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    registerRoute() {},
    registerJob() {},
    registerReportSection() {},
    exec,
    service() {
      throw new Error("not used");
    },
  };
}

const config = {
  executable: "/opt/bin/tmux-status",
  timeoutMs: 1_000,
  collectionIntervalSeconds: 60,
  cpuThreshold: 90,
  memoryThresholdMb: 2_048,
};

test("accepts v2 Codex/Grok panes and a v1 no-server snapshot", () => {
  const v2 = payload({
    pane_count: 2,
    panes: [
      pane({ tools: ["codex"] }),
      pane({ pane: "%4", pid: 200, tools: ["grok"], window_id: "@3" }),
    ],
  });
  (v2.panes[0] as any).agent_conversations = [{}];
  assert.deepEqual(parseStatusPayload(JSON.stringify(v2)), v2);
  assert.deepEqual(persistableConversations(v2, v2.panes[0]!), []);

  const v1 = {
    generated_at: "2026-07-31T02:00:00Z",
    thresholds: { cpu_percent: 80, memory_mb: 1_024 },
    pane_count: 0,
    anomaly_count: 0,
    panes: [],
  };
  assert.deepEqual(parseStatusPayload(JSON.stringify(v1)), v1);
});

test("accepts canonical v3 fixtures and rejects canonical invalid fixtures", () => {
  for (const name of ["confirmed", "unknown", "conflicting", "no-server"]) {
    const fixture = contractFixture("fixtures", name);
    const parsed = parseStatusPayload(fixture);
    assert.deepEqual(parsed, JSON.parse(fixture));
    if (parsed.panes.length > 0) {
      assert.equal(
        persistableConversations(parsed, parsed.panes[0]!).length,
        1
      );
    }
  }

  for (const name of [
    "missing-v2-identity",
    "oversized-cpu-percent",
    "oversized-memory-mb",
  ]) {
    assert.throws(
      () => parseStatusPayload(contractFixture("fixtures-invalid", name)),
      (error) =>
        error instanceof PluginError && error.code === "PLUGIN_OUTPUT_INVALID"
    );
  }
});

test("rejects guessed or internally inconsistent v3 conversation identities", () => {
  const unknown = JSON.parse(contractFixture("fixtures", "unknown"));
  unknown.panes[0].agent_conversations[0].conversation_id =
    "019fc532-c5ba-7b90-a199-5ecd6d99bf69";
  assert.throws(() => parseStatusPayload(JSON.stringify(unknown)), PluginError);

  const confirmed = JSON.parse(contractFixture("fixtures", "confirmed"));
  confirmed.panes[0].agent_conversations[0].stable_mapping_key =
    "codex:019fb21f-84c9-7692-8371-1f9aa3e75401";
  confirmed.recovery[0].stable_mapping_key =
    "codex:019fb21f-84c9-7692-8371-1f9aa3e75401";
  assert.throws(() => parseStatusPayload(JSON.stringify(confirmed)), PluginError);

  const nilUuid = JSON.parse(contractFixture("fixtures", "confirmed"));
  nilUuid.panes[0].agent_conversations[0].conversation_id =
    "00000000-0000-0000-0000-000000000000";
  nilUuid.panes[0].agent_conversations[0].stable_mapping_key =
    "codex:00000000-0000-0000-0000-000000000000";
  nilUuid.recovery[0].conversation_id = "00000000-0000-0000-0000-000000000000";
  nilUuid.recovery[0].stable_mapping_key =
    "codex:00000000-0000-0000-0000-000000000000";
  nilUuid.panes[0].agent_conversations[0].resume_command =
    "codex resume -C /tmp/project 00000000-0000-0000-0000-000000000000";
  nilUuid.recovery[0].resume_command =
    nilUuid.panes[0].agent_conversations[0].resume_command;
  assert.deepEqual(parseStatusPayload(JSON.stringify(nilUuid)), nilUuid);

  const badCount = JSON.parse(contractFixture("fixtures", "confirmed"));
  badCount.confirmed_conversation_count = 0;
  assert.throws(() => parseStatusPayload(JSON.stringify(badCount)), PluginError);

  const badAnomalyCount = JSON.parse(contractFixture("fixtures", "confirmed"));
  badAnomalyCount.panes[0].anomalies = ["high_cpu"];
  assert.throws(
    () => parseStatusPayload(JSON.stringify(badAnomalyCount)),
    PluginError
  );

  const reusedProcess = JSON.parse(contractFixture("fixtures", "confirmed"));
  reusedProcess.panes[0].agent_conversations.push({
    ...reusedProcess.panes[0].agent_conversations[0],
    conversation_id: "019fc532-c5ba-7b90-a199-5ecd6d99bf69",
    stable_mapping_key: "codex:019fc532-c5ba-7b90-a199-5ecd6d99bf69",
    resume_command:
      "codex resume -C /tmp/project 019fc532-c5ba-7b90-a199-5ecd6d99bf69",
  });
  reusedProcess.confirmed_conversation_count = 2;
  reusedProcess.recovery.push({
    ...reusedProcess.recovery[0],
    conversation_id: "019fc532-c5ba-7b90-a199-5ecd6d99bf69",
    stable_mapping_key: "codex:019fc532-c5ba-7b90-a199-5ecd6d99bf69",
    resume_command:
      "codex resume -C /tmp/project 019fc532-c5ba-7b90-a199-5ecd6d99bf69",
  });
  assert.throws(
    () => parseStatusPayload(JSON.stringify(reusedProcess)),
    PluginError
  );

  const wrongVersion = JSON.parse(contractFixture("fixtures", "confirmed"));
  wrongVersion.tool_version = "0.2.0";
  wrongVersion.producer.version = "0.2.0";
  assert.throws(() => parseStatusPayload(JSON.stringify(wrongVersion)), PluginError);

  const guessedSource = JSON.parse(contractFixture("fixtures", "unknown"));
  guessedSource.panes[0].agent_conversations[0].identity_source = "recent_session";
  guessedSource.recovery[0].identity_source = "recent_session";
  assert.throws(() => parseStatusPayload(JSON.stringify(guessedSource)), PluginError);

  for (const sourcePath of [null, "sessions/rollout.jsonl"]) {
    const invalidFileSource = JSON.parse(
      contractFixture("fixtures", "confirmed")
    );
    invalidFileSource.panes[0].agent_conversations[0].source_path = sourcePath;
    invalidFileSource.recovery[0].source_path = sourcePath;
    assert.throws(
      () => parseStatusPayload(JSON.stringify(invalidFileSource)),
      PluginError
    );
  }

  const invalidCliSource = JSON.parse(contractFixture("fixtures", "confirmed"));
  invalidCliSource.panes[0].agent_conversations[0].identity_source =
    "cli_resume_argument";
  invalidCliSource.recovery[0].identity_source = "cli_resume_argument";
  assert.throws(() => parseStatusPayload(JSON.stringify(invalidCliSource)), PluginError);

  const validCliSource = JSON.parse(contractFixture("fixtures", "confirmed"));
  validCliSource.panes[0].agent_conversations[0].identity_source =
    "cli_resume_argument";
  validCliSource.panes[0].agent_conversations[0].source_path = null;
  validCliSource.recovery[0].identity_source = "cli_resume_argument";
  validCliSource.recovery[0].source_path = null;
  assert.deepEqual(parseStatusPayload(JSON.stringify(validCliSource)), validCliSource);

  const invalidCodexSessionIdSource = structuredClone(validCliSource);
  invalidCodexSessionIdSource.panes[0].agent_conversations[0].identity_source =
    "cli_session_id_argument";
  invalidCodexSessionIdSource.recovery[0].identity_source =
    "cli_session_id_argument";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(invalidCodexSessionIdSource)),
    PluginError
  );

  const validGrokSessionIdSource = structuredClone(validCliSource);
  const grokConversation =
    validGrokSessionIdSource.panes[0].agent_conversations[0];
  const grokRecovery = validGrokSessionIdSource.recovery[0];
  validGrokSessionIdSource.panes[0].tools = ["grok"];
  grokConversation.tool = "grok";
  grokConversation.conversation_id_kind = "grok_session_id";
  grokConversation.identity_source = "cli_session_id_argument";
  grokConversation.stable_mapping_key = `grok:${grokConversation.conversation_id}`;
  grokConversation.resume_command =
    `grok --cwd /tmp/project --resume ${grokConversation.conversation_id}`;
  grokRecovery.tool = "grok";
  grokRecovery.conversation_id_kind = "grok_session_id";
  grokRecovery.identity_source = "cli_session_id_argument";
  grokRecovery.stable_mapping_key = grokConversation.stable_mapping_key;
  grokRecovery.resume_command = grokConversation.resume_command;
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(validGrokSessionIdSource)),
    validGrokSessionIdSource
  );

  const missingCwd = JSON.parse(contractFixture("fixtures", "unknown"));
  missingCwd.panes[0].agent_conversations[0].working_directory = null;
  missingCwd.recovery[0].working_directory = null;
  assert.deepEqual(parseStatusPayload(JSON.stringify(missingCwd)), missingCwd);

  const wrongResume = JSON.parse(contractFixture("fixtures", "confirmed"));
  wrongResume.panes[0].agent_conversations[0].resume_command =
    "codex resume -C /tmp/project 00000000-0000-0000-0000-000000000000 private-text";
  wrongResume.recovery[0].resume_command =
    wrongResume.panes[0].agent_conversations[0].resume_command;
  assert.throws(() => parseStatusPayload(JSON.stringify(wrongResume)), PluginError);

  const emptyConfirmedCwd = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  emptyConfirmedCwd.panes[0].agent_conversations[0].working_directory = "";
  emptyConfirmedCwd.panes[0].agent_conversations[0].resume_command =
    `codex resume -C '' ${emptyConfirmedCwd.recovery[0].conversation_id}`;
  emptyConfirmedCwd.recovery[0].working_directory = "";
  emptyConfirmedCwd.recovery[0].resume_command =
    emptyConfirmedCwd.panes[0].agent_conversations[0].resume_command;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(emptyConfirmedCwd)),
    PluginError
  );

  const relativeConfirmedCwd = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  relativeConfirmedCwd.panes[0].agent_conversations[0].working_directory =
    "project";
  relativeConfirmedCwd.panes[0].agent_conversations[0].resume_command =
    `codex resume -C project ${relativeConfirmedCwd.recovery[0].conversation_id}`;
  relativeConfirmedCwd.recovery[0].working_directory = "project";
  relativeConfirmedCwd.recovery[0].resume_command =
    relativeConfirmedCwd.panes[0].agent_conversations[0].resume_command;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(relativeConfirmedCwd)),
    PluginError
  );

  const quotedCwd = JSON.parse(contractFixture("fixtures", "confirmed"));
  quotedCwd.panes[0].agent_conversations[0].working_directory =
    "/tmp/my project's code";
  quotedCwd.recovery[0].working_directory = "/tmp/my project's code";
  quotedCwd.panes[0].agent_conversations[0].resume_command =
    `codex resume -C '/tmp/my project'"'"'s code' ${quotedCwd.recovery[0].conversation_id}`;
  quotedCwd.recovery[0].resume_command =
    quotedCwd.panes[0].agent_conversations[0].resume_command;
  assert.deepEqual(parseStatusPayload(JSON.stringify(quotedCwd)), quotedCwd);

  const mismatchedKind = JSON.parse(contractFixture("fixtures", "confirmed"));
  mismatchedKind.panes[0].agent_conversations[0].conversation_id_kind =
    "grok_session_id";
  mismatchedKind.recovery[0].conversation_id_kind = "grok_session_id";
  assert.throws(() => parseStatusPayload(JSON.stringify(mismatchedKind)), PluginError);

  const mismatchedRecovery = JSON.parse(contractFixture("fixtures", "confirmed"));
  mismatchedRecovery.recovery[0].conversation_id =
    "019fc532-c5ba-7b90-a199-5ecd6d99bf69";
  mismatchedRecovery.recovery[0].stable_mapping_key =
    "codex:019fc532-c5ba-7b90-a199-5ecd6d99bf69";
  mismatchedRecovery.recovery[0].resume_command =
    "codex resume -C /tmp/project 019fc532-c5ba-7b90-a199-5ecd6d99bf69";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(mismatchedRecovery)),
    (error) =>
      error instanceof PluginError &&
      error.message.includes("recovery projection is inconsistent")
  );

  const reorderedRecovery = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  const unknownEntry = JSON.parse(contractFixture("fixtures", "unknown"));
  unknownEntry.panes[0].pane = "%4";
  unknownEntry.panes[0].pane_id = "%4";
  unknownEntry.panes[0].pid = 200;
  unknownEntry.panes[0].pane_pid = 200;
  unknownEntry.panes[0].target = "work:0.1";
  unknownEntry.panes[0].tmux_target = "work:0.1";
  unknownEntry.panes[0].tmux_pane_index = 1;
  unknownEntry.panes[0].pane_instance_id =
    "500:1784999999:$1:1785000000:@2:%4:200";
  unknownEntry.recovery[0].tmux_target = "work:0.1";
  unknownEntry.recovery[0].pane_id = "%4";
  unknownEntry.recovery[0].pane_pid = 200;
  reorderedRecovery.panes.push(unknownEntry.panes[0]);
  reorderedRecovery.recovery.push(unknownEntry.recovery[0]);
  reorderedRecovery.pane_count = 2;
  reorderedRecovery.unknown_conversation_count = 1;
  reorderedRecovery.recovery.reverse();
  assert.throws(
    () => parseStatusPayload(JSON.stringify(reorderedRecovery)),
    (error) =>
      error instanceof PluginError &&
      error.message.includes("recovery projection is inconsistent")
  );

  for (const invalidValue of [0, -1]) {
    const invalidPid = JSON.parse(contractFixture("fixtures", "confirmed"));
    invalidPid.panes[0].pid = invalidValue;
    invalidPid.panes[0].pane_pid = invalidValue;
    invalidPid.recovery[0].pane_pid = invalidValue;
    invalidPid.panes[0].pane_instance_id =
      `500:1784999999:$1:1785000000:@2:%3:${invalidValue}`;
    assert.throws(
      () => parseStatusPayload(JSON.stringify(invalidPid)),
      PluginError
    );
  }
});

test("enforces v3 resource constraints and additionalProperties false", () => {
  for (const [field, value] of [
    ["cpu_percent", -0.1],
    ["memory_mb", -1],
    ["process_count", -1],
    ["process_count", 1.5],
  ] as const) {
    const invalidMetric = JSON.parse(contractFixture("fixtures", "confirmed"));
    invalidMetric.panes[0][field] = value;
    assert.throws(() => parseStatusPayload(JSON.stringify(invalidMetric)), PluginError);
  }

  const extraTopLevel = JSON.parse(contractFixture("fixtures", "confirmed"));
  extraTopLevel.terminal_transcript = "must not cross the privacy boundary";
  assert.throws(() => parseStatusPayload(JSON.stringify(extraTopLevel)), PluginError);

  const extraConversation = JSON.parse(contractFixture("fixtures", "confirmed"));
  extraConversation.panes[0].agent_conversations[0].prompt = "private";
  assert.throws(() => parseStatusPayload(JSON.stringify(extraConversation)), PluginError);

  const extraLocations: Array<(value: any) => void> = [
    (value) => { value.producer.private_token = "secret"; },
    (value) => { value.thresholds.extra = 1; },
    (value) => { value.panes[0].terminal_transcript = "private"; },
    (value) => { value.recovery[0].prompt = "private"; },
  ];
  for (const mutate of extraLocations) {
    const extraField = JSON.parse(contractFixture("fixtures", "confirmed"));
    mutate(extraField);
    assert.throws(() => parseStatusPayload(JSON.stringify(extraField)), PluginError);
  }

  const nulMetadata = JSON.parse(contractFixture("fixtures", "confirmed"));
  nulMetadata.panes[0].agent_conversations[0].source_path =
    "session\0path";
  nulMetadata.recovery[0].source_path = "session\0path";
  assert.throws(() => parseStatusPayload(JSON.stringify(nulMetadata)), PluginError);

  const unpairedSurrogate = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  unpairedSurrogate.panes[0].agent_conversations[0]
    .process_instances["101"] = "101:\ud800";
  unpairedSurrogate.recovery[0].process_instances["101"] = "101:\ud800";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(unpairedSurrogate)),
    PluginError
  );

  const validAstralText = JSON.parse(contractFixture("fixtures", "confirmed"));
  validAstralText.panes[0].agent_conversations[0].evidence = "valid 😀";
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(validAstralText)),
    validAstralText
  );

  const invalidThreshold = JSON.parse(contractFixture("fixtures", "confirmed"));
  invalidThreshold.thresholds.cpu_percent = -1;
  assert.throws(() => parseStatusPayload(JSON.stringify(invalidThreshold)), PluginError);

  const validMaximumThresholds = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  validMaximumThresholds.thresholds.cpu_percent = 1_000_000;
  validMaximumThresholds.thresholds.memory_mb = 1_000_000_000;
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(validMaximumThresholds)),
    validMaximumThresholds
  );

  for (const mutate of [
    (value: any) => { value.thresholds.cpu_percent = 1_000_001; },
    (value: any) => { value.thresholds.memory_mb = 1_000_000_001; },
    (value: any) => { value.panes[0].cpu_percent = 1_000_001; },
    (value: any) => { value.panes[0].memory_mb = 1_000_000_001; },
  ]) {
    const oversizedResource = JSON.parse(
      contractFixture("fixtures", "confirmed")
    );
    mutate(oversizedResource);
    assert.throws(
      () => parseStatusPayload(JSON.stringify(oversizedResource)),
      PluginError
    );
  }

  const arbitraryPrecisionCpu = contractFixture("fixtures", "confirmed")
    .replace('"cpu_percent": 12.5', '"cpu_percent": 1e400');
  assert.throws(() => parseStatusPayload(arbitraryPrecisionCpu), PluginError);

  for (const generatedAt of [
    "2026-08-03",
    "2026-08-03T12:00:00",
    "2026-02-30T12:00:00Z",
    "1990-12-31T23:59:60Z",
    "2026-08-03T12:00:00.0000001Z",
    "2026-08-03T12:00:00+16:00",
    "2026-08-03T12:00:00-23:59",
    "0000-01-01T00:00:00Z",
  ]) {
    const invalidTimestamp = JSON.parse(contractFixture("fixtures", "confirmed"));
    invalidTimestamp.generated_at = generatedAt;
    assert.throws(
      () => parseStatusPayload(JSON.stringify(invalidTimestamp)),
      PluginError
    );
  }

  const lowercaseSeparators = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  lowercaseSeparators.generated_at = "2026-08-03t12:00:00z";
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(lowercaseSeparators)),
    lowercaseSeparators
  );

  const microsecondTimestamp = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  microsecondTimestamp.generated_at = "2026-08-03T12:00:00.000001Z";
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(microsecondTimestamp)),
    microsecondTimestamp
  );
  microsecondTimestamp.generated_at = "2026-08-03T12:00:00.000001+15:59";
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(microsecondTimestamp)),
    microsecondTimestamp
  );

  for (const mutate of [
    (value: any) => { value.panes[0].cpu_percent = 100; },
    (value: any) => { value.panes[0].memory_mb = 2_048; },
    (value: any) => {
      value.panes[0].cpu_percent = 0;
      value.panes[0].anomalies = ["CPU"];
      value.anomaly_count = 1;
    },
    (value: any) => {
      value.panes[0].dead = true;
      value.panes[0].agent_conversations = [];
      value.recovery = [];
      value.confirmed_conversation_count = 0;
    },
  ]) {
    const inconsistentAnomaly = JSON.parse(
      contractFixture("fixtures", "confirmed")
    );
    mutate(inconsistentAnomaly);
    assert.throws(
      () => parseStatusPayload(JSON.stringify(inconsistentAnomaly)),
      PluginError
    );
  }

  const ambiguousRoundedThreshold = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  ambiguousRoundedThreshold.panes[0].cpu_percent = 80;
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(ambiguousRoundedThreshold)),
    ambiguousRoundedThreshold
  );
  ambiguousRoundedThreshold.panes[0].anomalies = ["CPU"];
  ambiguousRoundedThreshold.anomaly_count = 1;
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(ambiguousRoundedThreshold)),
    ambiguousRoundedThreshold
  );

  const missingZeroThresholdLabels = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  missingZeroThresholdLabels.thresholds = { cpu_percent: 0, memory_mb: 0 };
  missingZeroThresholdLabels.panes[0].cpu_percent = 0;
  missingZeroThresholdLabels.panes[0].memory_mb = 0;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(missingZeroThresholdLabels)),
    PluginError
  );
  missingZeroThresholdLabels.panes[0].anomalies = ["CPU", "MEM"];
  missingZeroThresholdLabels.anomaly_count = 1;
  assert.deepEqual(
    parseStatusPayload(JSON.stringify(missingZeroThresholdLabels)),
    missingZeroThresholdLabels
  );
});

test("rejects corrupted and unsupported tmux JSON", () => {
  assert.throws(
    () => parseStatusPayload("{not-json"),
    (error) =>
      error instanceof PluginError && error.code === "PLUGIN_OUTPUT_INVALID"
  );
  assert.throws(
    () => parseStatusPayload(JSON.stringify(payload({ schema_version: 99 }))),
    (error) =>
      error instanceof PluginError && error.code === "PLUGIN_OUTPUT_INVALID"
  );
});

test("adapter uses execFile-shaped arguments and returns upstream JSON", async () => {
  let request: unknown;
  const snapshot = payload();
  const adapter = new TmuxStatusAdapter(
    context(async (value) => {
      request = value;
      return {
        stdout: JSON.stringify(snapshot),
        stderr: "",
        exitCode: 0,
      };
    }),
    config
  );

  assert.deepEqual(await adapter.status(), snapshot);
  assert.deepEqual(request, {
    executable: "/opt/bin/tmux-status",
    args: [
      "status",
      "--json",
      "--cpu-threshold",
      "90",
      "--memory-threshold",
      "2048",
    ],
    timeoutMs: 1_000,
  });
});

test("adapter maps missing executables and timeouts to structured errors", async () => {
  const missing = new TmuxStatusAdapter(
    context(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }),
    config
  );
  await assert.rejects(
    missing.status(),
    (error) =>
      error instanceof PluginError &&
      error.code === "PLUGIN_DEPENDENCY_MISSING" &&
      error.statusCode === 503
  );

  const timeout = new TmuxStatusAdapter(
    context(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }),
    config
  );
  await assert.rejects(
    timeout.status(),
    (error) =>
      error instanceof PluginError &&
      error.code === "PLUGIN_TIMEOUT" &&
      error.statusCode === 504
  );

  const execFileTimeout = new TmuxStatusAdapter(
    context(async () => {
      throw Object.assign(new Error("Command failed"), {
        killed: true,
        signal: "SIGTERM",
      });
    }),
    config
  );
  await assert.rejects(
    execFileTimeout.status(),
    (error) =>
      error instanceof PluginError &&
      error.code === "PLUGIN_TIMEOUT" &&
      error.statusCode === 504
  );
});

test("session and pane observation identities survive reuse scenarios", () => {
  const original = pane();
  assert.notEqual(
    sessionKey(original),
    sessionKey(pane({
      session_created: original.session_created! + 10,
      pane_instance_id: "new-session-pane",
    }))
  );
  assert.notEqual(
    paneIdentity(original),
    paneIdentity(pane({
      pid: original.pid + 1,
      pane_instance_id: "new-process-pane",
    }))
  );
  assert.notEqual(
    paneIdentity(original),
    paneIdentity(pane({
      window_id: "@9",
      pane_instance_id: "new-window-pane",
    }))
  );
});

test("conversation persistence keys are idempotent without inventing unknown IDs", () => {
  const confirmedPayload = JSON.parse(contractFixture("fixtures", "confirmed"));
  const confirmedPane = confirmedPayload.panes[0] as TmuxPaneStatus;
  const confirmedConversation = confirmedPane.agent_conversations![0]!;
  const confirmedKey = conversationObservationKey(
    confirmedPane,
    confirmedConversation
  );
  assert.match(confirmedKey, /^[0-9a-f]{64}$/);

  const uppercaseConversationId = confirmedConversation.conversation_id!.toUpperCase();
  assert.equal(
    conversationObservationKey(confirmedPane, {
      ...confirmedConversation,
      conversation_id: uppercaseConversationId,
      stable_mapping_key: `codex:${uppercaseConversationId}`,
      resume_command:
        `codex resume -C /tmp/project ${uppercaseConversationId}`,
    }),
    confirmedKey
  );
  assert.notEqual(
    conversationObservationKey(
      { ...confirmedPane, pane_instance_id: `${confirmedPane.pane_instance_id}:other` },
      confirmedConversation
    ),
    confirmedKey
  );
  assert.notEqual(
    conversationObservationKey(confirmedPane, {
      ...confirmedConversation,
      tool: "grok",
      conversation_id_kind: "grok_session_id",
      conversation_id: "019fc532-c5ba-7b90-a199-5ecd6d99bf69",
    }),
    confirmedKey
  );

  const unknownPayload = JSON.parse(contractFixture("fixtures", "unknown"));
  const unknownPane = unknownPayload.panes[0] as TmuxPaneStatus;
  const unknownConversation = unknownPane.agent_conversations![0]!;
  const key = conversationObservationKey(unknownPane, unknownConversation);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(unknownConversation.conversation_id, null);
  assert.equal(unknownConversation.stable_mapping_key, null);
  assert.equal(unknownConversation.resume_command, null);

  const sameProcessesDifferentOrder = {
    ...unknownConversation,
    process_instances: Object.fromEntries(
      Object.entries(unknownConversation.process_instances).reverse()
    ),
  };
  assert.equal(
    conversationObservationKey(unknownPane, sameProcessesDifferentOrder),
    key
  );
  assert.equal(
    conversationObservationKey(
      { ...unknownPane, pane_instance_id: "p".repeat(20_000) },
      {
        ...unknownConversation,
        working_directory: `/${"deep/".repeat(5_000)}`,
        process_instances: { "102": "i".repeat(20_000) },
      }
    ).length,
    64
  );
  assert.notEqual(
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      process_instances: { "102": "102:different-process-start" },
    }),
    key
  );
  assert.notEqual(
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      working_directory: "/tmp/another-project",
    }),
    key
  );

  assert.notEqual(
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      process_instances: { "102": "a,b", "103": "c" },
    }),
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      process_instances: { "102": "a", "103": "b,c" },
    })
  );
});

test("validates the canonical PID-to-incarnation map", () => {
  for (const processInstances of [
    {},
    { "0": "invalid-pid" },
    { abc: "invalid-pid" },
    { "102": "" },
    { "102": "102:" },
    { "102": "103:different-process" },
    { "2147483648": "2147483648:outside-postgres-integer-range" },
  ]) {
    const invalid = JSON.parse(contractFixture("fixtures", "unknown"));
    invalid.panes[0].agent_conversations[0].process_instances = processInstances;
    invalid.recovery[0].process_instances = processInstances;
    assert.throws(() => parseStatusPayload(JSON.stringify(invalid)), PluginError);
  }

  const opaque = JSON.parse(contractFixture("fixtures", "unknown"));
  opaque.panes[0].agent_conversations[0].process_instances = {
    "102": "102:opaque-process-incarnation",
    "103": "103:second-opaque-incarnation",
  };
  opaque.recovery[0].process_instances = {
    "102": "102:opaque-process-incarnation",
    "103": "103:second-opaque-incarnation",
  };
  assert.deepEqual(parseStatusPayload(JSON.stringify(opaque)), opaque);

  const reusedPid = JSON.parse(contractFixture("fixtures", "unknown"));
  const secondUnknown = structuredClone(
    reusedPid.panes[0].agent_conversations[0]
  );
  secondUnknown.process_instances = {
    "102": "102:different-process-incarnation",
  };
  reusedPid.panes[0].agent_conversations.push(secondUnknown);
  const secondRecovery = structuredClone(reusedPid.recovery[0]);
  secondRecovery.process_instances = secondUnknown.process_instances;
  reusedPid.recovery.push(secondRecovery);
  reusedPid.unknown_conversation_count = 2;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(reusedPid)),
    PluginError
  );
});

test("binds v3 pane identities and rejects contradictory pre-restart metadata", () => {
  const opaquePane = JSON.parse(contractFixture("fixtures", "confirmed"));
  opaquePane.panes[0].pane_instance_id = "opaque-pane-incarnation";
  assert.throws(() => parseStatusPayload(JSON.stringify(opaquePane)), PluginError);

  for (const [field, value] of [
    ["target", "legacy:9.8"],
    ["session", "legacy-session"],
    ["window", "9:legacy-window"],
    ["pane", "%9"],
    ["pid", 999],
    ["path", "/legacy/path"],
  ] as const) {
    const contradictoryAlias = JSON.parse(
      contractFixture("fixtures", "confirmed")
    );
    contradictoryAlias.panes[0][field] = value;
    assert.throws(
      () => parseStatusPayload(JSON.stringify(contradictoryAlias)),
      PluginError
    );
  }

  const mismatchedProducer = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  mismatchedProducer.producer.version = "0.3.1";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(mismatchedProducer)),
    PluginError
  );

  const wrongDerivedTarget = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  wrongDerivedTarget.panes[0].target = "other:9.9";
  wrongDerivedTarget.panes[0].tmux_target = "other:9.9";
  wrongDerivedTarget.recovery[0].tmux_target = "other:9.9";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(wrongDerivedTarget)),
    PluginError
  );

  const emptyPaneIdentity = JSON.parse(contractFixture("fixtures", "confirmed"));
  emptyPaneIdentity.panes[0].pane_instance_id = "";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(emptyPaneIdentity)),
    PluginError
  );

  const oversizedPanePid = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  oversizedPanePid.panes[0].pid = 2_147_483_648;
  oversizedPanePid.panes[0].pane_pid = 2_147_483_648;
  oversizedPanePid.recovery[0].pane_pid = 2_147_483_648;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(oversizedPanePid)),
    PluginError
  );

  const oversizedSessionCreated = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  oversizedSessionCreated.panes[0].session_created = 9_007_199_254_740_992;
  oversizedSessionCreated.panes[0].pane_instance_id =
    "500:1784999999:$1:9007199254740992:@2:%3:100";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(oversizedSessionCreated)),
    PluginError
  );

  const oversizedWindowIndex = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  oversizedWindowIndex.panes[0].tmux_window_index =
    9_007_199_254_740_992;
  oversizedWindowIndex.panes[0].window = "9007199254740992:code";
  oversizedWindowIndex.panes[0].target = "work:9007199254740992.0";
  oversizedWindowIndex.panes[0].tmux_target = "work:9007199254740992.0";
  oversizedWindowIndex.recovery[0].tmux_target = "work:9007199254740992.0";
  assert.throws(
    () => parseStatusPayload(JSON.stringify(oversizedWindowIndex)),
    PluginError
  );

  const oversizedServerIdentity = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  const oversizedServerId = "12345678901:1784999999";
  oversizedServerIdentity.server_instance_id = oversizedServerId;
  oversizedServerIdentity.panes[0].server_instance_id = oversizedServerId;
  oversizedServerIdentity.panes[0].pane_instance_id =
    `${oversizedServerId}:$1:1785000000:@2:%3:100`;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(oversizedServerIdentity)),
    PluginError
  );

  const deadPaneConversation = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  deadPaneConversation.panes[0].dead = true;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(deadPaneConversation)),
    PluginError
  );

  const duplicateConfirmedMapping = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  const secondConfirmed = structuredClone(
    duplicateConfirmedMapping.panes[0].agent_conversations[0]
  );
  const uppercaseConversationId = secondConfirmed.conversation_id.toUpperCase();
  secondConfirmed.conversation_id = uppercaseConversationId;
  secondConfirmed.stable_mapping_key = `codex:${uppercaseConversationId}`;
  secondConfirmed.resume_command =
    `codex resume -C /tmp/project ${uppercaseConversationId}`;
  secondConfirmed.process_instances = { "102": "102:second-process" };
  duplicateConfirmedMapping.panes[0].agent_conversations.push(secondConfirmed);
  const secondConfirmedRecovery = structuredClone(
    duplicateConfirmedMapping.recovery[0]
  );
  secondConfirmedRecovery.conversation_id = uppercaseConversationId;
  secondConfirmedRecovery.stable_mapping_key = `codex:${uppercaseConversationId}`;
  secondConfirmedRecovery.resume_command =
    `codex resume -C /tmp/project ${uppercaseConversationId}`;
  secondConfirmedRecovery.process_instances = secondConfirmed.process_instances;
  duplicateConfirmedMapping.recovery.push(secondConfirmedRecovery);
  duplicateConfirmedMapping.confirmed_conversation_count = 2;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(duplicateConfirmedMapping)),
    PluginError
  );

  const duplicatePaneIdentity = JSON.parse(
    contractFixture("fixtures", "confirmed")
  );
  const secondPane = structuredClone(duplicatePaneIdentity.panes[0]);
  secondPane.agent_conversations = [];
  duplicatePaneIdentity.panes.push(secondPane);
  duplicatePaneIdentity.pane_count = 2;
  assert.throws(
    () => parseStatusPayload(JSON.stringify(duplicatePaneIdentity)),
    PluginError
  );

  for (const mutate of [
    (payload: any) => { payload.panes[0].process_count = 0; },
    (payload: any) => { payload.panes[0].tools = []; },
  ]) {
    const inconsistentSummary = JSON.parse(
      contractFixture("fixtures", "confirmed")
    );
    mutate(inconsistentSummary);
    assert.throws(
      () => parseStatusPayload(JSON.stringify(inconsistentSummary)),
      PluginError
    );
  }

  for (const [reportType, preRestart] of [
    ["snapshot", true],
    ["recovery", false],
  ] as const) {
    const payload = JSON.parse(contractFixture("fixtures", "confirmed"));
    payload.report_type = reportType;
    payload.pre_restart = preRestart;
    assert.throws(() => parseStatusPayload(JSON.stringify(payload)), PluginError);
  }
});

test("plugin appends immutable conversation migrations", () => {
  assert.deepEqual(
    tmuxStatusPlugin.migrations?.map((migration) => migration.name),
    [
      "001_tmux_observations",
      "002_tmux_agent_conversations",
      "003_tmux_process_instances",
      "004_tmux_nullable_agent_cwd",
    ]
  );
  const sql = tmuxStatusPlugin.migrations?.[1]?.sql ?? "";
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tmux_agent_conversations/);
  assert.match(sql, /conversation_id_status = 'unknown'/);
  assert.match(
    tmuxStatusPlugin.migrations?.[2]?.sql ?? "",
    /ADD COLUMN IF NOT EXISTS process_instances JSONB/
  );
  assert.ok("processInstances" in tmuxAgentConversations);
  assert.match(
    tmuxStatusPlugin.migrations?.[3]?.sql ?? "",
    /ALTER COLUMN working_directory DROP NOT NULL/
  );
});

test("conversation upsert preserves earliest observation under reordered writes", () => {
  const source = readFileSync(
    new URL("../plugins/tmux-status/src/store.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /first_observed_at = LEAST\(/);
  assert.match(source, /last_observed_at = GREATEST\(/);
  assert.match(source, /last_generated_at = GREATEST\(/);
  assert.match(
    source,
    /snapshot\.schema_version === 3[\s\S]*new Date\(snapshot\.generated_at\)\.toISOString\(\)/
  );
  assert.match(source, /minuteBucket\(new Date\(generatedAt\)\)/);
  assert.doesNotMatch(source, /const generatedAt = new Date/);
  assert.doesNotMatch(
    source,
    /WHERE tmux_agent_conversations\.last_generated_at\s*< EXCLUDED\.last_generated_at/
  );
  assert.match(
    source,
    /cpu_average = tmux_pane_minutes\.cpu_average \+ \([\s\S]*EXCLUDED\.cpu_average - tmux_pane_minutes\.cpu_average[\s\S]*tmux_pane_minutes\.sample_count \+ 1/
  );
  assert.doesNotMatch(
    source,
    /cpu_average \* tmux_pane_minutes\.sample_count/
  );
});

test("persistence timestamps preserve v3 precision and normalize legacy offsets", () => {
  const legacy = payload({ generated_at: "2026-08-03T12:00:00+23:59" });
  assert.equal(persistenceTimestamp(legacy), "2026-08-02T12:01:00.000Z");

  const v3 = JSON.parse(contractFixture("fixtures", "confirmed"));
  v3.generated_at = "2026-08-03T12:00:00.000001Z";
  assert.equal(persistenceTimestamp(v3), v3.generated_at);
});

test("manual mark passes target, state, and note as separate arguments", async () => {
  let args: string[] = [];
  const adapter = new TmuxStatusAdapter(
    context(async (request) => {
      args = request.args;
      return { stdout: "Marked %3 as active.\n", stderr: "", exitCode: 0 };
    }),
    config
  );

  const result = await adapter.mark("%3", "active", "release task");
  assert.deepEqual(args, [
    "mark",
    "%3",
    "active",
    "--note",
    "release task",
  ]);
  assert.equal(result.message, "Marked %3 as active.");
});

test("doctor validates the executable version and live status contract", async () => {
  const requests: string[][] = [];
  const adapter = new TmuxStatusAdapter(
    context(async (request) => {
      requests.push(request.args);
      if (request.args[0] === "--version") {
        return { stdout: "0.2.0\n", stderr: "", exitCode: 0 };
      }
      return { stdout: JSON.stringify(payload()), stderr: "", exitCode: 0 };
    }),
    config
  );

  const result = await adapter.doctor();
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((check) => [check.id, check.ok]), [
    ["executable", true],
    ["version", true],
    ["status-contract", true],
  ]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.[0], "status");
});

test("doctor rejects unsupported versions before collecting status", async () => {
  let requests = 0;
  const adapter = new TmuxStatusAdapter(
    context(async () => {
      requests++;
      return { stdout: "0.0.9\n", stderr: "", exitCode: 0 };
    }),
    config
  );

  const result = await adapter.doctor();
  assert.equal(result.ok, false);
  assert.equal(requests, 1);
  assert.deepEqual(result.checks.map((check) => [check.id, check.ok]), [
    ["executable", true],
    ["version", false],
  ]);
});

test("doctor reports malformed live status output as a contract failure", async () => {
  const adapter = new TmuxStatusAdapter(
    context(async (request) => request.args[0] === "--version"
      ? { stdout: "tmux-status 0.1.4\n", stderr: "", exitCode: 0 }
      : { stdout: "{broken", stderr: "", exitCode: 0 }),
    config
  );

  const result = await adapter.doctor();
  assert.equal(result.ok, false);
  const contract = result.checks.find((check) => check.id === "status-contract");
  assert.equal(contract?.ok, false);
  assert.deepEqual(contract?.details, { code: "PLUGIN_OUTPUT_INVALID" });
});
