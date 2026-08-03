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
  sessionKey,
} from "../plugins/tmux-status/src/store.js";
import { tmuxStatusPlugin } from "../plugins/tmux-status/src/index.js";
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
  assert.deepEqual(parseStatusPayload(JSON.stringify(v2)), v2);

  const v1 = {
    generated_at: "2026-07-31T02:00:00Z",
    thresholds: { cpu_percent: 80, memory_mb: 1_024 },
    pane_count: 0,
    anomaly_count: 0,
    panes: [],
  };
  assert.deepEqual(parseStatusPayload(JSON.stringify(v1)), v1);
});

test("accepts canonical v3 fixtures and rejects v3 missing v2 identity", () => {
  for (const name of ["confirmed", "unknown", "conflicting", "no-server"]) {
    const fixture = contractFixture("fixtures", name);
    assert.deepEqual(parseStatusPayload(fixture), JSON.parse(fixture));
  }

  assert.throws(
    () => parseStatusPayload(contractFixture("fixtures-invalid", "missing-v2-identity")),
    (error) =>
      error instanceof PluginError && error.code === "PLUGIN_OUTPUT_INVALID"
  );
});

test("rejects guessed or internally inconsistent v3 conversation identities", () => {
  const unknown = JSON.parse(contractFixture("fixtures", "unknown"));
  unknown.panes[0].agent_conversations[0].conversation_id =
    "019fc532-c5ba-7b90-a199-5ecd6d99bf69";
  assert.throws(() => parseStatusPayload(JSON.stringify(unknown)), PluginError);

  const confirmed = JSON.parse(contractFixture("fixtures", "confirmed"));
  confirmed.panes[0].agent_conversations[0].stable_mapping_key = "codex:wrong";
  assert.throws(() => parseStatusPayload(JSON.stringify(confirmed)), PluginError);

  const badCount = JSON.parse(contractFixture("fixtures", "confirmed"));
  badCount.confirmed_conversation_count = 0;
  assert.throws(() => parseStatusPayload(JSON.stringify(badCount)), PluginError);

  const wrongVersion = JSON.parse(contractFixture("fixtures", "confirmed"));
  wrongVersion.tool_version = "0.2.0";
  wrongVersion.producer.version = "0.2.0";
  assert.throws(() => parseStatusPayload(JSON.stringify(wrongVersion)), PluginError);

  const guessedSource = JSON.parse(contractFixture("fixtures", "unknown"));
  guessedSource.panes[0].agent_conversations[0].identity_source = "recent_session";
  guessedSource.recovery[0].identity_source = "recent_session";
  assert.throws(() => parseStatusPayload(JSON.stringify(guessedSource)), PluginError);

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

  const invalidThreshold = JSON.parse(contractFixture("fixtures", "confirmed"));
  invalidThreshold.thresholds.cpu_percent = -1;
  assert.throws(() => parseStatusPayload(JSON.stringify(invalidThreshold)), PluginError);

  for (const generatedAt of [
    "2026-08-03",
    "2026-08-03T12:00:00",
    "2026-02-30T12:00:00Z",
  ]) {
    const invalidTimestamp = JSON.parse(contractFixture("fixtures", "confirmed"));
    invalidTimestamp.generated_at = generatedAt;
    assert.throws(
      () => parseStatusPayload(JSON.stringify(invalidTimestamp)),
      PluginError
    );
  }
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
  assert.equal(
    JSON.parse(confirmedKey).at(-1),
    confirmedConversation.stable_mapping_key
  );
  assert.notEqual(
    conversationObservationKey(
      { ...confirmedPane, pane_instance_id: `${confirmedPane.pane_instance_id}:other` },
      confirmedConversation
    ),
    confirmedKey
  );

  const unknownPayload = JSON.parse(contractFixture("fixtures", "unknown"));
  const unknownPane = unknownPayload.panes[0] as TmuxPaneStatus;
  const unknownConversation = unknownPane.agent_conversations![0]!;
  const key = conversationObservationKey(unknownPane, unknownConversation);
  assert.equal(JSON.parse(key)[0], "unknown");
  assert.equal(unknownConversation.conversation_id, null);
  assert.equal(unknownConversation.stable_mapping_key, null);
  assert.equal(unknownConversation.resume_command, null);

  const sameProcessesDifferentOrder = {
    ...unknownConversation,
    process_pids: [...unknownConversation.process_pids].reverse(),
    process_instance_keys: [...unknownConversation.process_instance_keys].reverse(),
  };
  assert.equal(
    conversationObservationKey(unknownPane, sameProcessesDifferentOrder),
    key
  );
  assert.notEqual(
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      process_instance_keys: [
        `${unknownConversation.process_pids[0]!}:different-process-start`,
      ],
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
      process_instance_keys: ["a,b", "c"],
    }),
    conversationObservationKey(unknownPane, {
      ...unknownConversation,
      process_instance_keys: ["a", "b,c"],
    })
  );
});

test("validates process-instance keys exactly as the canonical v3 schema", () => {
  for (const processInstanceKeys of [[], ["duplicate", "duplicate"]]) {
    const invalid = JSON.parse(contractFixture("fixtures", "unknown"));
    invalid.panes[0].agent_conversations[0].process_instance_keys =
      processInstanceKeys;
    invalid.recovery[0].process_instance_keys = processInstanceKeys;
    assert.throws(() => parseStatusPayload(JSON.stringify(invalid)), PluginError);
  }

  const opaque = JSON.parse(contractFixture("fixtures", "unknown"));
  opaque.panes[0].agent_conversations[0].process_instance_keys = [
    "opaque-process-incarnation",
    "second-opaque-incarnation",
  ];
  opaque.recovery[0].process_instance_keys = [
    "opaque-process-incarnation",
    "second-opaque-incarnation",
  ];
  assert.deepEqual(parseStatusPayload(JSON.stringify(opaque)), opaque);
});

test("accepts opaque pane identities and rejects contradictory pre-restart metadata", () => {
  const opaquePane = JSON.parse(contractFixture("fixtures", "confirmed"));
  opaquePane.panes[0].pane_instance_id = "opaque-pane-incarnation";
  assert.deepEqual(parseStatusPayload(JSON.stringify(opaquePane)), opaquePane);

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

test("plugin appends immutable conversation mapping migration 002", () => {
  assert.deepEqual(
    tmuxStatusPlugin.migrations?.map((migration) => migration.name),
    ["001_tmux_observations", "002_tmux_agent_conversations"]
  );
  const sql = tmuxStatusPlugin.migrations?.[1]?.sql ?? "";
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tmux_agent_conversations/);
  assert.match(sql, /conversation_id_status = 'unknown'/);
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
