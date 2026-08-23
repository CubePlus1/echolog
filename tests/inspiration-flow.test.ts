import assert from "node:assert/strict";
import test from "node:test";
import type {
  PluginHttpRequest,
  PluginNotificationResult,
} from "@echolog/plugin-sdk";
import { createFlowRoutes, validateOutcome, validateSettingsUpdate } from "../plugins/inspiration/src/flow-routes.js";
import { FlowStoreError, type FlowOutcomeResult, type FlowReserveResult } from "../plugins/inspiration/src/flow-store.js";
import {
  createFlowJob,
  FlowService,
  scheduledFlowDedupeKey,
  type FlowPersistence,
} from "../plugins/inspiration/src/flow.js";
import {
  candidateExclusionReasons,
  isQuietMinute,
  selectFlowCandidate,
  type SelectableInspiration,
} from "../plugins/inspiration/src/selector.js";
import type {
  FlowCandidate,
  FlowDelivery,
  FlowSettings,
  Inspiration,
} from "../plugins/inspiration/src/types.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function inspiration(
  overrides: Partial<Inspiration> = {}
): Inspiration {
  return {
    id: "idea-a",
    version: 1,
    content: "Build a deterministic inspiration flow",
    tags: ["product"],
    project: "echolog",
    status: "inbox",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    archivedAt: null,
    lastSurfacedAt: null,
    ...overrides,
  };
}

function settings(overrides: Partial<FlowSettings> = {}): FlowSettings {
  return {
    id: "default",
    version: 1,
    enabled: true,
    intervalMinutes: 60,
    quietStartMinute: 0,
    quietEndMinute: 0,
    cooldownMinutes: 60,
    dailyLimit: 3,
    defaultSnoozeMinutes: 120,
    statuses: ["inbox", "kept"],
    tags: [],
    projects: [],
    updatedAt: NOW,
    ...overrides,
  };
}

function delivery(overrides: Partial<FlowDelivery> = {}): FlowDelivery {
  return {
    id: "delivery-a",
    version: 1,
    attempts: 1,
    inspirationId: "idea-a",
    source: "manual",
    dedupeKey: "manual:request-a",
    status: "reserved",
    outcome: null,
    surfacedAt: NOW,
    notifiedAt: null,
    snoozedUntil: null,
    outcomeAt: null,
    notificationChannel: null,
    notificationChannels: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function candidate(overrides: Partial<FlowCandidate> = {}): FlowCandidate {
  return {
    inspiration: inspiration({ version: 2, lastSurfacedAt: NOW }),
    delivery: delivery(),
    explanation: ["selection:never-surfaced-first"],
    duplicate: false,
    ...overrides,
  };
}

function selectable(
  inspirationOverrides: Partial<Inspiration> = {},
  snoozedUntil: Date | null = null
): SelectableInspiration {
  return { inspiration: inspiration(inspirationOverrides), snoozedUntil };
}

function reserveResult(value = candidate()): FlowReserveResult {
  return {
    candidate: value,
    explanation: value.explanation,
    shouldNotify: value.delivery.status === "reserved",
  };
}

function outcomeResult(): FlowOutcomeResult {
  return {
    delivery: delivery({ version: 2, status: "acted", outcome: "later" }),
    inspiration: inspiration({ version: 2, lastSurfacedAt: NOW }),
  };
}

function persistence(
  overrides: Partial<FlowPersistence> = {}
): FlowPersistence {
  return {
    async getSettings() {
      return settings();
    },
    async updateSettings() {
      return settings({ version: 2 });
    },
    async reserveNext() {
      return reserveResult();
    },
    async finalizeNotification(_id, _version, result) {
      return result.delivered
        ? delivery({
            version: 2,
            status: "sent",
            notifiedAt: result.at,
            notificationChannels: result.channels,
          })
        : delivery({
            version: 2,
            status: "failed",
            notificationChannels: result.channels,
            error: result.error,
          });
    },
    async listDeliveries() {
      return [];
    },
    async applyOutcome() {
      return outcomeResult();
    },
    async getDailySummary() {
      return { captured: 0, surfaced: 0, outcomes: {} };
    },
    ...overrides,
  };
}

test("quiet-hour policy handles daytime, overnight, and disabled ranges", () => {
  assert.equal(isQuietMinute(10 * 60, 9 * 60, 17 * 60), true);
  assert.equal(isQuietMinute(18 * 60, 9 * 60, 17 * 60), false);
  assert.equal(isQuietMinute(23 * 60, 22 * 60, 8 * 60), true);
  assert.equal(isQuietMinute(7 * 60 + 59, 22 * 60, 8 * 60), true);
  assert.equal(isQuietMinute(8 * 60, 22 * 60, 8 * 60), false);
  assert.equal(isQuietMinute(12 * 60, 0, 0), false);
});

test("manual and scheduled Flow use identical candidate ranking", () => {
  const candidates = [
    selectable({
      id: "surfaced",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      lastSurfacedAt: new Date("2026-08-01T00:00:00.000Z"),
    }),
    selectable({
      id: "never-b",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    }),
    selectable({
      id: "never-a",
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    }),
  ];
  const common = {
    candidates,
    settings: settings(),
    now: NOW,
    surfacedToday: 0,
  };
  assert.equal(
    selectFlowCandidate({ ...common, source: "manual" }).selected?.inspiration.id,
    "never-a"
  );
  assert.equal(
    selectFlowCandidate({ ...common, source: "scheduled" }).selected?.inspiration.id,
    "never-a"
  );
});

test("scheduled gates enabled and overnight quiet hours while manual bypasses only those gates", () => {
  const localNow = new Date(2026, 7, 24, 23, 30);
  const common = {
    candidates: [selectable()],
    settings: settings({
      enabled: false,
      quietStartMinute: 22 * 60,
      quietEndMinute: 8 * 60,
    }),
    now: localNow,
    surfacedToday: 0,
  };
  assert.deepEqual(
    selectFlowCandidate({ ...common, source: "scheduled" }).explanation,
    ["policy:disabled", "policy:quiet-hours"]
  );
  assert.equal(
    selectFlowCandidate({ ...common, source: "manual" }).selected?.inspiration.id,
    "idea-a"
  );
});

test("daily limit applies to both sources", () => {
  for (const source of ["manual", "scheduled"] as const) {
    const result = selectFlowCandidate({
      candidates: [selectable()],
      settings: settings({ dailyLimit: 2 }),
      source,
      now: NOW,
      surfacedToday: 2,
    });
    assert.equal(result.selected, null);
    assert.deepEqual(result.explanation, ["policy:daily-limit"]);
  }
});

test("selector explains lifecycle, filter, snooze, and cooldown exclusions", () => {
  assert.deepEqual(
    candidateExclusionReasons(
      selectable(
        {
          status: "archived",
          archivedAt: NOW,
          tags: ["other"],
          project: "other",
          lastSurfacedAt: new Date(NOW.getTime() - 10 * 60_000),
        },
        new Date(NOW.getTime() + 60_000)
      ),
      settings({ tags: ["product"], projects: ["echolog"] }),
      NOW
    ),
    [
      "lifecycle:archived",
      "filter:tags",
      "filter:project",
      `delivery:snoozed-until:${new Date(NOW.getTime() + 60_000).toISOString()}`,
      `policy:cooldown-until:${new Date(NOW.getTime() + 50 * 60_000).toISOString()}`,
    ]
  );

  const selection = selectFlowCandidate({
    candidates: [selectable({ status: "archived", archivedAt: NOW })],
    settings: settings(),
    source: "manual",
    now: NOW,
    surfacedToday: 0,
  });
  assert.deepEqual(selection.explanation, [
    "selection:no-eligible-inspirations",
    "excluded:idea-a:lifecycle:archived",
  ]);
});

test("scheduled bucket keys are stable across repeated polls and vary by interval", () => {
  const withinBucket = new Date(NOW.getTime() + 30_000);
  assert.equal(
    scheduledFlowDedupeKey(NOW, 60),
    scheduledFlowDedupeKey(withinBucket, 60)
  );
  assert.notEqual(
    scheduledFlowDedupeKey(NOW, 60),
    scheduledFlowDedupeKey(NOW, 30)
  );
});

test("scheduled job is bounded and forwards the Host abort signal", async () => {
  const observed: AbortSignal[] = [];
  const service = {
    async runScheduled(signal: AbortSignal) {
      observed.push(signal);
      return { candidate: null, explanation: [] };
    },
  } as unknown as FlowService;
  const job = createFlowJob(service);
  const controller = new AbortController();
  await job.run(controller.signal);
  assert.equal(job.id, "inspiration-flow");
  assert.equal(job.intervalMs, 60_000);
  assert.equal(job.timeoutMs, 30_000);
  assert.deepEqual(observed, [controller.signal]);
});

test("service calls the function-valued notification contract with title and message only", async () => {
  const finalized: unknown[] = [];
  const sent: Array<{ input: unknown; signal: AbortSignal | undefined }> = [];
  const controller = new AbortController();
  const store = persistence({
    async finalizeNotification(...args) {
      finalized.push(args);
      return delivery({ version: 2, status: "sent", notifiedAt: NOW });
    },
  });
  const service = new FlowService(
    store,
    () => async (input, signal) => {
      sent.push({ input, signal });
      return {
        channels: {
          mac: { status: "sent" },
          ntfy: { status: "disabled" },
        },
      };
    },
    () => NOW
  );
  const result = await service.nextManual("request-a", controller.signal);
  assert.equal(result.candidate?.delivery.status, "sent");
  assert.deepEqual(sent, [{
    input: {
      title: "Inspiration",
      message: "Build a deterministic inspiration flow",
    },
    signal: controller.signal,
  }]);
  assert.equal(finalized.length, 1);
  assert.deepEqual((finalized[0] as unknown[]).slice(0, 2), ["delivery-a", 1]);
});

test("reserved duplicate resumes after restart but sent duplicate is not re-sent", async () => {
  let sends = 0;
  let state: "reserved" | "sent" = "reserved";
  const store = persistence({
    async reserveNext() {
      return reserveResult(candidate({
        duplicate: true,
        delivery: delivery({ status: state }),
      }));
    },
    async finalizeNotification() {
      state = "sent";
      return delivery({ version: 2, status: "sent" });
    },
  });
  const service = new FlowService(store, () => async () => {
      sends += 1;
      return {
        channels: {
          mac: { status: "sent" },
          ntfy: { status: "disabled" },
        },
      };
  }, () => NOW);

  await service.nextManual("same-request");
  await service.nextManual("same-request");
  assert.equal(sends, 1);
});

test("notification failures are recorded without leaking provider error text", async () => {
  let finalization: unknown;
  const service = new FlowService(persistence({
    async finalizeNotification(_id, _version, result) {
      finalization = result;
      return delivery({ version: 2, status: "failed", error: "notifications.send failed" });
    },
  }), () => async () => {
      throw new Error("secret provider response and echoed notification body");
  }, () => NOW);

  const result = await service.nextManual("failed-request");
  assert.equal(result.candidate?.delivery.status, "failed");
  assert.deepEqual(finalization, {
    delivered: false,
    channels: null,
    error: "notifications.send failed",
    at: NOW,
  });
});

test("channel results require at least one sent channel and remain ledgered", async () => {
  const cases: Array<{
    name: string;
    result: PluginNotificationResult;
    status: FlowDelivery["status"];
    error: string | null;
  }> = [
    {
      name: "sent plus failed",
      result: {
        channels: {
          mac: { status: "sent" },
          ntfy: { status: "failed", error: "ntfy notification failed" },
        },
      },
      status: "sent",
      error: null,
    },
    {
      name: "all disabled",
      result: {
        channels: {
          mac: { status: "disabled" },
          ntfy: { status: "disabled" },
        },
      },
      status: "failed",
      error: "notifications.send has no enabled channels",
    },
    {
      name: "disabled plus failed",
      result: {
        channels: {
          mac: { status: "disabled" },
          ntfy: { status: "failed", error: "ntfy notification timed out" },
        },
      },
      status: "failed",
      error: "notifications.send failed on all enabled channels",
    },
  ];

  for (const item of cases) {
    let finalization: Parameters<FlowPersistence["finalizeNotification"]>[2] | undefined;
    const service = new FlowService(persistence({
      async finalizeNotification(_id, _version, result) {
        finalization = result;
        return delivery({
          version: 2,
          status: result.delivered ? "sent" : "failed",
          notificationChannels: result.channels,
          error: result.delivered ? null : result.error,
        });
      },
    }), () => async () => item.result, () => NOW);

    const result = await service.nextManual(item.name);
    assert.equal(result.candidate?.delivery.status, item.status, item.name);
    assert.deepEqual(finalization?.channels, item.result.channels, item.name);
    assert.equal(
      finalization && !finalization.delivered ? finalization.error : null,
      item.error,
      item.name
    );
  }
});

test("notification ledger projects only bounded official channel fields", async () => {
  let finalization: Parameters<FlowPersistence["finalizeNotification"]>[2] | undefined;
  const oversizedError = "x".repeat(300);
  const providerResult = {
    channels: {
      mac: { status: "disabled", endpoint: "must-not-be-persisted" },
      ntfy: {
        status: "failed",
        error: oversizedError,
        responseBody: "must-not-be-persisted",
      },
      unexpected: { status: "sent", secret: "must-not-be-persisted" },
    },
    data: { deliveryId: "must-not-be-persisted" },
  } as unknown as PluginNotificationResult;
  const service = new FlowService(persistence({
    async finalizeNotification(_id, _version, result) {
      finalization = result;
      return delivery({
        version: 2,
        status: result.delivered ? "sent" : "failed",
        notificationChannels: result.channels,
        error: result.delivered ? null : result.error,
      });
    },
  }), () => async () => providerResult, () => NOW);

  const result = await service.nextManual("bounded-projection");

  assert.equal(result.candidate?.delivery.status, "failed");
  assert.deepEqual(finalization?.channels, {
    mac: { status: "disabled" },
    ntfy: { status: "failed", error: "x".repeat(160) },
  });
  assert.equal(JSON.stringify(finalization).includes("must-not-be-persisted"), false);
});

test("abort leaves a durable reservation for a later restart", async () => {
  let finalized = false;
  const controller = new AbortController();
  controller.abort();
  const service = new FlowService(persistence({
    async reserveNext() {
      return reserveResult();
    },
    async finalizeNotification() {
      finalized = true;
      return delivery();
    },
  }), () => async () => {
      assert.fail("notification must not be attempted after abort");
  }, () => NOW);

  await assert.rejects(
    service.nextManual("aborted", controller.signal),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(finalized, false);
});

test("later calculates delivery snooze without requesting a lifecycle mutation", async () => {
  let call: unknown[] | undefined;
  const service = new FlowService(persistence({
    async applyOutcome(...args) {
      call = args;
      return outcomeResult();
    },
  }), () => async () => ({
    channels: {
      mac: { status: "sent" },
      ntfy: { status: "disabled" },
    },
  }), () => NOW);

  await service.applyOutcome("delivery-a", {
    expectedDeliveryVersion: 2,
    expectedInspirationVersion: 2,
    outcome: "later",
    snoozeMinutes: 30,
  });
  assert.deepEqual(call, [
    "delivery-a",
    2,
    2,
    "later",
    new Date(NOW.getTime() + 30 * 60_000),
    NOW,
  ]);
});

test("Flow route validators reject schedule actions and stale outcomes map to 409", async () => {
  assert.deepEqual(validateOutcome({
    expectedDeliveryVersion: 1,
    expectedInspirationVersion: 2,
    outcome: "schedule",
  }), {
    ok: false,
    error: "outcome must be viewed, continued, kept, later, or archived",
  });
  assert.equal(validateSettingsUpdate({}).ok, false);

  const service = {
    async applyOutcome() {
      throw new FlowStoreError(
        "VERSION_CONFLICT",
        "Flow outcome version conflict",
        409,
        3,
        4
      );
    },
  } as unknown as FlowService;
  const route = createFlowRoutes(() => service).find(
    (item) => item.path.endsWith("/:id/outcome")
  )!;
  const request: PluginHttpRequest = {
    params: { id: "delivery-a" },
    query: {},
    body: {
      expectedDeliveryVersion: 2,
      expectedInspirationVersion: 2,
      outcome: "viewed",
    },
    headers: {},
  };
  const result = await route.handler(request, new AbortController().signal);
  assert.deepEqual(result, {
    statusCode: 409,
    body: {
      error: "Flow outcome version conflict",
      code: "VERSION_CONFLICT",
      currentDeliveryVersion: 3,
      currentInspirationVersion: 4,
    },
  });
});

test("settings validation normalizes tags consistently with Capture", () => {
  const result = validateSettingsUpdate({
    expectedVersion: 1,
    enabled: true,
    intervalMinutes: 60,
    quietStartMinute: 1_320,
    quietEndMinute: 480,
    cooldownMinutes: 60,
    dailyLimit: 3,
    defaultSnoozeMinutes: 120,
    statuses: ["inbox", "kept"],
    tags: ["Product", "ECHolog"],
    projects: ["EchoLog"],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.tags, ["echolog", "product"]);
    assert.deepEqual(result.value.projects, ["EchoLog"]);
  }
});

test("delivery API DTO retains the projected channel ledger", async () => {
  const projected = {
    mac: { status: "sent" as const },
    ntfy: { status: "failed" as const, error: "ntfy notification failed" },
  };
  const stored = delivery({
    status: "sent",
    notificationChannels: projected,
  });
  const service = {
    async listDeliveries(limit: number, before?: Date) {
      assert.equal(limit, 10);
      assert.equal(before?.toISOString(), "2026-08-24T13:00:00.000Z");
      return [stored];
    },
  } as unknown as FlowService;
  const route = createFlowRoutes(() => service).find(
    (item) => item.method === "GET" && item.path.endsWith("/deliveries")
  )!;
  const result = await route.handler({
    params: {},
    query: { limit: "10", before: "2026-08-24T13:00:00.000Z" },
    body: null,
    headers: {},
  }, new AbortController().signal);

  assert.deepEqual(result, { deliveries: [stored] });
  assert.deepEqual(
    (result as { deliveries: FlowDelivery[] }).deliveries[0]?.notificationChannels,
    projected
  );
});

test("Flow exposes only canonical inspiration plugin routes", () => {
  const paths = createFlowRoutes(() => ({} as FlowService)).map((route) => route.path);
  assert.deepEqual(paths, [
    "/api/plugins/inspiration/flow/settings",
    "/api/plugins/inspiration/flow/settings",
    "/api/plugins/inspiration/flow/next",
    "/api/plugins/inspiration/flow/deliveries",
    "/api/plugins/inspiration/flow/deliveries/:id/outcome",
  ]);
  assert.equal(paths.some((path) => path.includes("schedule")), false);
});
