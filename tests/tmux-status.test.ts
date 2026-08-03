import assert from "node:assert/strict";
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
  paneIdentity,
  sessionKey,
} from "../plugins/tmux-status/src/store.js";
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
