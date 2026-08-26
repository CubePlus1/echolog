import assert from "node:assert/strict";
import test from "node:test";
import type {
  PluginHttpRequest,
  PluginNotificationResult,
} from "@echolog/plugin-sdk";
import { createFlowRoutes, validateOutcome, validateSettingsUpdate } from "../plugins/inspiration/src/flow-routes.js";
import {
  canApplyFlowOutcome,
  FlowStoreError,
  type FlowOutcomeResult,
  type FlowReserveResult,
} from "../plugins/inspiration/src/flow-store.js";
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
import { encodeDeliveryCursor } from "../plugins/inspiration/src/pagination.js";
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
    async claimNotification(_id, _version, at, signal) {
      signal?.throwIfAborted();
      return delivery({
        version: 2,
        status: "dispatching",
        updatedAt: at ?? NOW,
      });
    },
    async finalizeNotification(_id, _version, result) {
      return result.delivered
        ? delivery({
            version: 3,
            status: "sent",
            notifiedAt: result.at,
            notificationChannels: result.channels,
          })
        : delivery({
            version: 3,
            status: "failed",
            notificationChannels: result.channels,
            error: result.error,
          });
    },
    async listDeliveries() {
      return { deliveries: [], nextCursor: null };
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

test("scheduled bucket keys include the locked settings version and interval", () => {
  const withinBucket = new Date(NOW.getTime() + 30_000);
  assert.equal(
    scheduledFlowDedupeKey(NOW, 4, 60),
    scheduledFlowDedupeKey(withinBucket, 4, 60)
  );
  assert.notEqual(
    scheduledFlowDedupeKey(NOW, 4, 60),
    scheduledFlowDedupeKey(NOW, 5, 60)
  );
  assert.notEqual(
    scheduledFlowDedupeKey(NOW, 5, 60),
    scheduledFlowDedupeKey(NOW, 5, 30)
  );
});

test("scheduled service delegates key generation to the locked Store snapshot", async () => {
  const calls: unknown[][] = [];
  let settingsReads = 0;
  const service = new FlowService(persistence({
    async getSettings() {
      settingsReads += 1;
      return settings();
    },
    async reserveNext(...args) {
      calls.push(args);
      return { candidate: null, explanation: [], shouldNotify: false };
    },
  }), () => async () => assert.fail("no candidate should not notify"), () => NOW);

  const controller = new AbortController();
  await service.runScheduled(controller.signal);

  assert.equal(settingsReads, 0);
  assert.deepEqual(calls, [["scheduled", undefined, NOW, controller.signal]]);
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

test("service calls notifications.send with text and the stable delivery dedupe key", async () => {
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
      dedupeKey: "inspiration:manual:request-a",
    },
    signal: controller.signal,
  }]);
  assert.equal(finalized.length, 1);
  assert.deepEqual((finalized[0] as unknown[]).slice(0, 2), ["delivery-a", 2]);
});

test("sent duplicate is not re-sent after the pre-send claim", async () => {
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

test("an interrupted dispatch is terminalized without another notification", async () => {
  let state: FlowDelivery["status"] = "reserved";
  let version = 1;
  let reserveCalls = 0;
  let sends = 0;
  const controller = new AbortController();
  const store = persistence({
    async reserveNext() {
      reserveCalls += 1;
      if (state === "dispatching") {
        state = "failed";
        version += 1;
      }
      const value = candidate({
        duplicate: reserveCalls > 1,
        delivery: delivery({ status: state, version }),
      });
      return {
        candidate: value,
        explanation: state === "failed"
          ? ["recovery:interrupted-dispatch-unknown"]
          : value.explanation,
        shouldNotify: state === "reserved",
      };
    },
    async claimNotification() {
      assert.equal(state, "reserved");
      state = "dispatching";
      version += 1;
      return delivery({ status: state, version });
    },
  });
  const service = new FlowService(store, () => async () => {
    sends += 1;
    controller.abort();
    return {
      channels: {
        mac: { status: "sent" },
        ntfy: { status: "disabled" },
      },
    };
  }, () => NOW);

  await assert.rejects(
    service.nextManual("same-request", controller.signal),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  const recovered = await service.nextManual("same-request");

  assert.equal(sends, 1);
  assert.equal(recovered.shouldNotify, false);
  assert.equal(recovered.candidate?.delivery.status, "failed");
  assert.deepEqual(recovered.explanation, [
    "recovery:interrupted-dispatch-unknown",
    "delivery:failed",
  ]);
});

test("an explicitly failed delivery can retry only as a distinct later bucket", async () => {
  let sends = 0;
  let nextDelivery = 0;
  const ids: string[] = [];
  const notificationKeys: Array<string | undefined> = [];
  let activeDedupeKey = "";
  const store = persistence({
    async reserveNext() {
      nextDelivery += 1;
      const id = `delivery-${nextDelivery}`;
      activeDedupeKey = `manual:bucket-${nextDelivery}`;
      ids.push(id);
      return reserveResult(candidate({
        delivery: delivery({ id, dedupeKey: activeDedupeKey }),
      }));
    },
    async claimNotification(id) {
      return delivery({
        id,
        version: 2,
        status: "dispatching",
        dedupeKey: activeDedupeKey,
      });
    },
    async finalizeNotification(id, _version, result) {
      return delivery({
        id,
        version: 3,
        status: result.delivered ? "sent" : "failed",
        error: result.delivered ? null : result.error,
      });
    },
  });
  const service = new FlowService(store, () => async (request) => {
    sends += 1;
    notificationKeys.push(request.dedupeKey);
    if (sends === 1) throw new Error("explicit transport failure");
    return {
      channels: {
        mac: { status: "sent" },
        ntfy: { status: "disabled" },
      },
    };
  }, () => NOW);

  const failed = await service.nextManual("bucket-1");
  const retried = await service.nextManual("bucket-2");

  assert.equal(failed.candidate?.delivery.status, "failed");
  assert.equal(retried.candidate?.delivery.status, "sent");
  assert.equal(sends, 2);
  assert.deepEqual(ids, ["delivery-1", "delivery-2"]);
  assert.deepEqual(notificationKeys, [
    "inspiration:manual:bucket-1",
    "inspiration:manual:bucket-2",
  ]);
});

test("failed deliveries are terminal and non-actionable for every source", () => {
  assert.equal(canApplyFlowOutcome({ status: "sent", source: "scheduled" }), true);
  assert.equal(canApplyFlowOutcome({ status: "failed", source: "manual" }), false);
  assert.equal(canApplyFlowOutcome({ status: "failed", source: "scheduled" }), false);
  assert.equal(canApplyFlowOutcome({ status: "dispatching", source: "manual" }), false);
});

test("a failed delivery is diagnostic only and the same key never sends twice", async () => {
  let sends = 0;
  let state: FlowDelivery["status"] = "reserved";
  let version = 1;
  const store = persistence({
    async reserveNext() {
      const value = candidate({
        duplicate: state === "failed",
        delivery: delivery({
          version,
          status: state,
          error: state === "failed" ? "notifications.send failed" : null,
        }),
      });
      return reserveResult(value);
    },
    async claimNotification() {
      state = "dispatching";
      version += 1;
      return delivery({ version, status: state });
    },
    async finalizeNotification(_id, _version, result) {
      state = "failed";
      version += 1;
      return delivery({
        version,
        status: state,
        error: result.delivered ? null : result.error,
      });
    },
  });
  const service = new FlowService(store, () => async () => {
    sends += 1;
    throw new Error("provider failed");
  }, () => NOW);

  const first = await service.nextManual("same-failed-key");
  const duplicate = await service.nextManual("same-failed-key");

  assert.equal(sends, 1);
  assert.equal(first.candidate?.delivery.status, "failed");
  assert.equal(duplicate.candidate?.delivery.status, "failed");
  assert.equal(duplicate.shouldNotify, false);
  assert.equal(duplicate.candidate?.delivery.error, "notifications.send failed");
  assert.deepEqual(duplicate.explanation, [
    "selection:never-surfaced-first",
    "delivery:failed",
  ]);
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
  assert.equal(result.explanation.includes("delivery:failed"), true);
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

test("abort before the pre-send claim never calls notifier or finalizer", async () => {
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
  const cursor = {
    surfacedAt: new Date("2026-08-24T13:00:00.000Z"),
    id: "delivery-z",
  };
  const service = {
    async listDeliveries(limit: number, receivedCursor?: typeof cursor) {
      assert.equal(limit, 10);
      assert.deepEqual(receivedCursor, cursor);
      return { deliveries: [stored], nextCursor: null };
    },
  } as unknown as FlowService;
  const route = createFlowRoutes(() => service).find(
    (item) => item.method === "GET" && item.path.endsWith("/deliveries")
  )!;
  const result = await route.handler({
    params: {},
    query: { limit: "10", cursor: encodeDeliveryCursor(cursor) },
    body: null,
    headers: {},
  }, new AbortController().signal);

  assert.deepEqual(result, { deliveries: [stored], nextCursor: null });
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
