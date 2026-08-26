import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_API_VERSION,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
} from "@echolog/plugin-sdk";
import {
  pollDueReminders,
  type ReminderPollResult,
  type ReminderStore,
} from "../plugins/schedule/src/reminders.js";
import {
  reminderDedupeKey,
  type DueReminder,
} from "../plugins/schedule/src/store.js";
import type {
  NotificationSend,
  NotificationSendResult,
  ReminderDelivery,
  ScheduleItem,
} from "../plugins/schedule/src/types.js";
import { PluginHost } from "../src/core/plugins/host.js";

const logger: PluginLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const sentResult: NotificationSendResult = {
  channels: {
    mac: { status: "sent" },
    ntfy: { status: "disabled" },
  },
};

function scheduleItem(): ScheduleItem {
  return {
    id: "schedule_host_001",
    title: "Host boundary reminder",
    description: null,
    scheduledStartAt: "2026-08-24T02:00:00.000Z",
    scheduledEndAt: null,
    timezone: "UTC",
    priority: 0,
    status: "scheduled",
    nextReminderAt: "2026-08-24T02:00:00.000Z",
    confirmedStartAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    awaitingConfirmation: true,
  };
}

function manifest(id: string): PluginManifest {
  return {
    manifestVersion: 1,
    id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    displayName: id,
    description: `${id} Schedule job boundary test plugin`,
    entries: {},
    capabilities: [],
    permissions: ["notifications:send"],
    requires: { coreApi: "^1.0.0" },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  readonly settled: boolean;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
    get settled() {
      return settled;
    },
  };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

class ObservedReminderStore implements ReminderStore {
  constructor(
    private readonly claimPending?: Deferred<ReminderDelivery | null>,
    private readonly finishPending?: Deferred<void>
  ) {}

  readonly item = scheduleItem();
  readonly reminderAt = new Date(this.item.nextReminderAt!);
  readonly deliveries = new Map<string, ReminderDelivery>();
  readonly finishCalls: Array<{
    id: string;
    status: "sent" | "failed";
    channelResults: NotificationSendResult["channels"] | null;
    failure: string | null;
  }> = [];
  readonly terminalCounters = { sent: 0, failed: 0 };
  dueCalls = 0;
  claimCalls = 0;
  readonly claimSignals: AbortSignal[] = [];
  readonly finishSignals: AbortSignal[] = [];
  finishAttempts = 0;
  private claimPendingUsed = false;

  async dueReminders(): Promise<DueReminder[]> {
    this.dueCalls++;
    return [{ item: this.item, reminderAt: this.reminderAt }];
  }

  async claimReminder(
    itemId: string,
    reminderAt: Date,
    _attemptedAt?: Date,
    signal?: AbortSignal
  ): Promise<ReminderDelivery | null> {
    signal?.throwIfAborted();
    this.claimCalls++;
    if (signal) this.claimSignals.push(signal);
    if (this.claimPending) {
      if (this.claimPendingUsed) return null;
      this.claimPendingUsed = true;
      return this.claimPending.promise;
    }
    const dedupeKey = reminderDedupeKey(itemId, reminderAt);
    if (this.deliveries.has(dedupeKey)) return null;
    const delivery: ReminderDelivery = {
      id: "delivery_host_001",
      dedupeKey,
      itemId,
      reminderAt: reminderAt.toISOString(),
      attemptedAt: new Date().toISOString(),
      completedAt: null,
      status: "claimed",
      channelResults: null,
      failure: null,
    };
    this.deliveries.set(dedupeKey, delivery);
    return delivery;
  }

  async finishReminder(
    id: string,
    input: {
      status: "sent" | "failed";
      channelResults: NotificationSendResult["channels"] | null;
      failure: string | null;
    },
    _completedAt?: Date,
    signal?: AbortSignal
  ): Promise<ReminderDelivery> {
    signal?.throwIfAborted();
    this.finishAttempts++;
    if (signal) this.finishSignals.push(signal);
    if (this.finishPending) await this.finishPending.promise;
    signal?.throwIfAborted();
    this.finishCalls.push({ id, ...input });
    this.terminalCounters[input.status]++;
    const delivery = [...this.deliveries.values()].find((entry) => entry.id === id);
    if (!delivery || delivery.status !== "claimed") {
      throw new Error(`delivery ${id} is not claimable`);
    }
    Object.assign(delivery, input, { completedAt: new Date().toISOString() });
    return delivery;
  }

  claimedDelivery(): ReminderDelivery {
    const delivery = [...this.deliveries.values()][0];
    assert.ok(delivery, "the first Host run should claim the due reminder");
    return delivery;
  }
}

interface JobHarness {
  host: PluginHost;
  store: ObservedReminderStore;
  getRuns(): number;
  getCompletedRunIds(): readonly number[];
  getSummaries(): ReadonlyArray<{ runId: number; result: ReminderPollResult }>;
}

function jobHarness(
  id: string,
  send: NotificationSend,
  options: {
    intervalMs: number;
    timeoutMs: number;
    claimPending?: Deferred<ReminderDelivery | null>;
    finishPending?: Deferred<void>;
  }
): JobHarness {
  const store = new ObservedReminderStore(
    options.claimPending,
    options.finishPending
  );
  let runs = 0;
  const completedRunIds: number[] = [];
  const summaries: Array<{ runId: number; result: ReminderPollResult }> = [];
  const definition: PluginDefinition = {
    manifest: manifest(id),
    defaultEnabled: true,
    register(context) {
      const notificationSend = context.service<NotificationSend>("notifications.send");
      context.registerJob({
        id: "reminder-poll",
        ...options,
        async run(signal) {
          const runId = ++runs;
          try {
            summaries.push({
              runId,
              result: await pollDueReminders(store, notificationSend, signal),
            });
          } finally {
            completedRunIds.push(runId);
          }
        },
      });
    },
  };
  const host = new PluginHost({
    definitions: [definition],
    logger,
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    services: { "notifications.send": send },
  });
  return {
    host,
    store,
    getRuns: () => runs,
    getCompletedRunIds: () => completedRunIds,
    getSummaries: () => summaries,
  };
}

function assertRetainedClaim(store: ObservedReminderStore): void {
  const delivery = store.claimedDelivery();
  assert.equal(delivery.status, "claimed");
  assert.equal(delivery.completedAt, null);
  assert.equal(delivery.channelResults, null);
  assert.equal(delivery.failure, null);
  assert.deepEqual(store.finishCalls, []);
  assert.deepEqual(store.terminalCounters, { sent: 0, failed: 0 });
  assert.equal(store.item.status, "scheduled");
  assert.equal(store.item.version, 1);
}

function assertNoClaim(store: ObservedReminderStore): void {
  assert.deepEqual(store.deliveries, new Map());
  assert.deepEqual(store.finishCalls, []);
  assert.deepEqual(store.terminalCounters, { sent: 0, failed: 0 });
  assert.equal(store.item.status, "scheduled");
  assert.equal(store.item.version, 1);
}

function claimDelivery(store: ObservedReminderStore): ReminderDelivery {
  return {
    id: "late-claim-host",
    dedupeKey: reminderDedupeKey(store.item.id, store.reminderAt),
    itemId: store.item.id,
    reminderAt: store.reminderAt.toISOString(),
    attemptedAt: new Date().toISOString(),
    completedAt: null,
    status: "claimed",
    channelResults: null,
    failure: null,
  };
}

function captureUnhandledRejections(): {
  reasons: unknown[];
  stop(): void;
} {
  const reasons: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  return {
    reasons,
    stop() {
      process.off("unhandledRejection", onUnhandledRejection);
    },
  };
}

const timeoutSettlements: Array<{
  name: string;
  settle(pending: Deferred<NotificationSendResult>): void;
}> = [
  {
    name: "late success",
    settle: (pending) => pending.resolve(sentResult),
  },
  {
    name: "late AbortError rejection",
    settle: (pending) => pending.reject(Object.assign(
      new Error("notification caller aborted"),
      { name: "AbortError" }
    )),
  },
  {
    name: "late non-abort rejection",
    settle: (pending) => pending.reject(new Error("provider rejected after timeout")),
  },
];

for (const [index, scenario] of timeoutSettlements.entries()) {
  test(`PluginHost timeout retains the Schedule claim after ${scenario.name}`, {
    timeout: 3_000,
  }, async () => {
    const pending = deferred<NotificationSendResult>();
    let sendCalls = 0;
    const sendSignals: AbortSignal[] = [];
    const harness = jobHarness(
      `schedule-timeout-${index}`,
      async (_request, sendSignal) => {
        sendCalls++;
        assert.ok(sendSignal, "Schedule must forward the Host caller signal");
        sendSignals.push(sendSignal);
        return pending.promise;
      },
      { intervalMs: 8, timeoutMs: 20 }
    );

    try {
      await harness.host.initialize();
      await waitFor(() => sendCalls === 1, "the first Host run did not reach send");
      await waitFor(
        () =>
          harness.host.list()[0]?.error?.code === "PLUGIN_TIMEOUT" &&
          harness.getRuns() >= 2 &&
          harness.getSummaries().some(({ runId }) => runId > 1),
        "Host did not release the timed-out run for a subsequent interval"
      );

      assert.equal(sendCalls, 1, "the retained exact claim must not be sent twice");
      assert.equal(sendSignals[0]?.aborted, true);
      assert.ok(harness.store.claimCalls >= 2, "a later Host run should observe dedupe");
      assertRetainedClaim(harness.store);

      scenario.settle(pending);
      await waitFor(
        () => harness.getCompletedRunIds().includes(1),
        "the late first continuation did not settle"
      );

      assert.equal(harness.host.list()[0]?.error?.code, "PLUGIN_TIMEOUT");
      assert.equal(sendCalls, 1);
      assertRetainedClaim(harness.store);
    } finally {
      if (!pending.settled) pending.resolve(sentResult);
      await harness.host.stop();
    }
  });
}

const stopSettlements: Array<{
  name: string;
  settle(pending: Deferred<NotificationSendResult>): void;
}> = [
  {
    name: "late success",
    settle: (pending) => pending.resolve(sentResult),
  },
  {
    name: "late rejection",
    settle: (pending) => pending.reject(new Error("provider rejected after stop")),
  },
];

for (const [index, scenario] of stopSettlements.entries()) {
  test(`PluginHost stop retains the Schedule claim after ${scenario.name}`, {
    timeout: 3_000,
  }, async () => {
    const pending = deferred<NotificationSendResult>();
    let sendCalls = 0;
    const sendSignals: AbortSignal[] = [];
    let stopped = false;
    const harness = jobHarness(
      `schedule-stop-${index}`,
      async (_request, sendSignal) => {
        sendCalls++;
        assert.ok(sendSignal, "Schedule must forward the Host caller signal");
        sendSignals.push(sendSignal);
        return pending.promise;
      },
      { intervalMs: 8, timeoutMs: 1_000 }
    );

    try {
      await harness.host.initialize();
      await waitFor(() => sendCalls === 1, "the Host run did not reach send before stop");
      assertRetainedClaim(harness.store);

      await harness.host.stop();
      stopped = true;
      assert.equal(harness.host.list()[0]?.state, "stopping");
      assert.equal(sendSignals[0]?.aborted, true);

      scenario.settle(pending);
      await waitFor(
        () => harness.getCompletedRunIds().includes(1),
        "the stopped job's late continuation did not settle"
      );

      assert.equal(sendCalls, 1);
      assertRetainedClaim(harness.store);
    } finally {
      if (!pending.settled) pending.resolve(sentResult);
      if (!stopped) await harness.host.stop();
    }
  });
}

const blockedFinalizationSettlements: Array<{
  name: string;
  send: NotificationSend;
  settle(pending: Deferred<void>): void;
}> = [
  {
    name: "sent finalization resolving late",
    send: async () => sentResult,
    settle: (pending) => pending.resolve(),
  },
  {
    name: "failed finalization resolving late",
    send: async () => { throw new Error("provider unavailable before finalization"); },
    settle: (pending) => pending.resolve(),
  },
  {
    name: "finalization rejecting late",
    send: async () => sentResult,
    settle: (pending) => pending.reject(new Error("database rejected after timeout")),
  },
];

for (const [index, scenario] of blockedFinalizationSettlements.entries()) {
  test(`PluginHost timeout revokes Schedule ${scenario.name}`, {
    timeout: 3_000,
  }, async () => {
    const pendingFinish = deferred<void>();
    const unhandled = captureUnhandledRejections();
    const harness = jobHarness(
      `schedule-finalization-timeout-${index}`,
      scenario.send,
      { intervalMs: 8, timeoutMs: 20, finishPending: pendingFinish }
    );

    try {
      await harness.host.initialize();
      await waitFor(
        () => harness.store.finishAttempts === 1,
        "the first Host run did not reach finalization"
      );
      assert.equal(
        harness.store.finishSignals[0],
        harness.store.claimSignals[0],
        "Schedule must propagate the exact Host signal into finalization"
      );
      await waitFor(
        () =>
          harness.host.list()[0]?.error?.code === "PLUGIN_TIMEOUT" &&
          harness.getRuns() >= 2,
        "Host did not release the blocked finalization"
      );
      assert.equal(harness.store.finishSignals[0]?.aborted, true);
      assertRetainedClaim(harness.store);

      scenario.settle(pendingFinish);
      await waitFor(
        () => harness.getCompletedRunIds().includes(1),
        "the late finalization continuation did not settle"
      );
      await new Promise<void>((resolve) => setImmediate(resolve));

      assertRetainedClaim(harness.store);
      assert.deepEqual(unhandled.reasons, []);
    } finally {
      if (!pendingFinish.settled) pendingFinish.resolve();
      await harness.host.stop();
      unhandled.stop();
    }
  });
}

test("PluginHost timeout isolates a late claim from Schedule persistence", {
  timeout: 3_000,
}, async () => {
  const pendingClaim = deferred<ReminderDelivery | null>();
  let sendCalls = 0;
  const harness = jobHarness(
    "schedule-claim-timeout",
    async () => {
      sendCalls++;
      return sentResult;
    },
    { intervalMs: 8, timeoutMs: 20, claimPending: pendingClaim }
  );

  try {
    await harness.host.initialize();
    await waitFor(
      () => harness.store.claimCalls === 1 && harness.store.claimSignals.length === 1,
      "the first Host run did not reach claim"
    );
    await waitFor(
      () =>
        harness.host.list()[0]?.error?.code === "PLUGIN_TIMEOUT" &&
        harness.getRuns() >= 2,
      "Host did not timeout and release the blocked claim"
    );
    assert.equal(harness.store.claimSignals[0]?.aborted, true);
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);

    pendingClaim.resolve(claimDelivery(harness.store));
    await waitFor(
      () => harness.getCompletedRunIds().includes(1),
      "the late claim continuation did not settle"
    );
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);
  } finally {
    if (!pendingClaim.settled) pendingClaim.resolve(null);
    await harness.host.stop();
  }
});

test("PluginHost stop isolates a late claim from Schedule persistence", {
  timeout: 3_000,
}, async () => {
  const pendingClaim = deferred<ReminderDelivery | null>();
  let sendCalls = 0;
  const harness = jobHarness(
    "schedule-claim-stop",
    async () => {
      sendCalls++;
      return sentResult;
    },
    { intervalMs: 8, timeoutMs: 1_000, claimPending: pendingClaim }
  );

  try {
    await harness.host.initialize();
    await waitFor(
      () => harness.store.claimCalls === 1 && harness.store.claimSignals.length === 1,
      "the Host run did not reach claim before stop"
    );
    await harness.host.stop();
    assert.equal(harness.store.claimSignals[0]?.aborted, true);
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);

    pendingClaim.resolve(claimDelivery(harness.store));
    await waitFor(
      () => harness.getCompletedRunIds().includes(1),
      "the stopped claim continuation did not settle"
    );
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);
  } finally {
    if (!pendingClaim.settled) pendingClaim.resolve(null);
    // stop() is idempotent but avoid a second call when it already completed.
    if (harness.host.list()[0]?.state !== "stopping") await harness.host.stop();
  }
});

test("PluginHost timeout contains a late ordinary claim rejection", {
  timeout: 3_000,
}, async () => {
  const pendingClaim = deferred<ReminderDelivery | null>();
  const unhandled = captureUnhandledRejections();
  let sendCalls = 0;
  const harness = jobHarness(
    "schedule-claim-timeout-rejection",
    async () => {
      sendCalls++;
      return sentResult;
    },
    { intervalMs: 8, timeoutMs: 20, claimPending: pendingClaim }
  );

  try {
    await harness.host.initialize();
    await waitFor(
      () => harness.store.claimCalls === 1 && harness.store.claimSignals.length === 1,
      "the first Host run did not reach claim"
    );
    await waitFor(
      () =>
        harness.host.list()[0]?.error?.code === "PLUGIN_TIMEOUT" &&
        harness.getRuns() >= 2,
      "Host did not timeout and release the rejected claim"
    );

    pendingClaim.reject(new Error("claim transport rejected after timeout"));
    await waitFor(
      () => harness.getCompletedRunIds().includes(1),
      "the late rejected claim continuation did not settle"
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(harness.store.claimSignals[0]?.aborted, true);
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);
    assert.deepEqual(unhandled.reasons, []);
  } finally {
    if (!pendingClaim.settled) pendingClaim.resolve(null);
    await harness.host.stop();
    unhandled.stop();
  }
});

test("PluginHost stop contains a late ordinary claim rejection", {
  timeout: 3_000,
}, async () => {
  const pendingClaim = deferred<ReminderDelivery | null>();
  const unhandled = captureUnhandledRejections();
  let sendCalls = 0;
  let stopped = false;
  const harness = jobHarness(
    "schedule-claim-stop-rejection",
    async () => {
      sendCalls++;
      return sentResult;
    },
    { intervalMs: 8, timeoutMs: 1_000, claimPending: pendingClaim }
  );

  try {
    await harness.host.initialize();
    await waitFor(
      () => harness.store.claimCalls === 1 && harness.store.claimSignals.length === 1,
      "the Host run did not reach claim before stop"
    );
    await harness.host.stop();
    stopped = true;

    pendingClaim.reject(new Error("claim transport rejected after stop"));
    await waitFor(
      () => harness.getCompletedRunIds().includes(1),
      "the stopped job's late rejected claim did not settle"
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(harness.store.claimSignals[0]?.aborted, true);
    assert.equal(sendCalls, 0);
    assertNoClaim(harness.store);
    assert.deepEqual(unhandled.reasons, []);
  } finally {
    if (!pendingClaim.settled) pendingClaim.resolve(null);
    if (!stopped) await harness.host.stop();
    unhandled.stop();
  }
});

const ordinaryFailures: Array<{
  name: string;
  send: NotificationSend;
  expectedFailure: RegExp;
}> = [
  {
    name: "internal channel failure",
    send: async () => ({
      channels: {
        mac: { status: "disabled" },
        ntfy: { status: "failed", error: "ntfy offline" },
      },
    }),
    expectedFailure: /mac: disabled; ntfy: ntfy offline/,
  },
  {
    name: "ordinary service rejection",
    send: async () => {
      throw new Error("notification provider unavailable");
    },
    expectedFailure: /notification provider unavailable/,
  },
];

for (const [index, scenario] of ordinaryFailures.entries()) {
  test(`PluginHost Schedule job terminalizes ${scenario.name}`, {
    timeout: 3_000,
  }, async () => {
    let sendCalls = 0;
    const harness = jobHarness(
      `schedule-failure-${index}`,
      async (request, signal) => {
        sendCalls++;
        return scenario.send(request, signal);
      },
      { intervalMs: 8, timeoutMs: 200 }
    );

    try {
      await harness.host.initialize();
      await waitFor(
        () => harness.store.finishCalls.length === 1,
        "the ordinary failure did not reach the ReminderStore finish seam"
      );

      const delivery = harness.store.claimedDelivery();
      assert.equal(delivery.status, "failed");
      assert.ok(delivery.completedAt);
      assert.match(delivery.failure ?? "", scenario.expectedFailure);
      assert.deepEqual(harness.store.terminalCounters, { sent: 0, failed: 1 });
      assert.equal(sendCalls, 1);
      assert.equal(harness.store.item.status, "scheduled");
      assert.equal(harness.store.item.version, 1);
    } finally {
      await harness.host.stop();
    }
  });
}
