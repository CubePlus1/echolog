import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  PluginContext,
  PluginDefinition,
  PluginJob,
  PluginManifest,
} from "@echolog/plugin-sdk";
import {
  SCHEDULE_REMINDER_JOB_TIMEOUT_MS,
  schedulePlugin,
} from "../plugins/schedule/src/index.js";
import { pollDueReminders, type ReminderStore } from "../plugins/schedule/src/reminders.js";
import { createScheduleRoutes } from "../plugins/schedule/src/routes.js";
import {
  ScheduleConflictError,
  reminderDedupeKey,
  scheduleItemFromRow,
  type DueReminder,
} from "../plugins/schedule/src/store.js";
import type {
  NotificationSendResult,
  ReminderDelivery,
  ScheduleItem,
} from "../plugins/schedule/src/types.js";
import {
  validateCreateScheduleItem,
  validateEditScheduleItem,
  validateListQuery,
  validateSnoozeBody,
} from "../plugins/schedule/src/validation.js";
import { PluginHost } from "../src/core/plugins/host.js";

const signal = new AbortController().signal;

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "schedule_001",
    title: "Plan release",
    description: null,
    scheduledStartAt: "2026-08-24T02:00:00.000Z",
    scheduledEndAt: "2026-08-24T03:00:00.000Z",
    timezone: "Asia/Shanghai",
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
    ...overrides,
  };
}

function request(overrides: Partial<{
  params: Record<string, string>;
  query: unknown;
  body: unknown;
}> = {}) {
  return {
    params: {},
    query: {},
    body: undefined,
    headers: {},
    ...overrides,
  };
}

function manifest(id: string): PluginManifest {
  return {
    manifestVersion: 1,
    id,
    version: "1.0.0",
    apiVersion: "1",
    displayName: id,
    description: `${id} test plugin`,
    entries: {},
    capabilities: [],
    permissions: [],
    requires: { coreApi: "^1.0.0" },
  };
}

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

test("Schedule manifest, config, migrations, and imports preserve plugin boundaries", () => {
  assert.equal(schedulePlugin.manifest.id, "schedule");
  assert.equal(schedulePlugin.defaultEnabled, true);
  assert.deepEqual(schedulePlugin.manifest.permissions, [
    "database:plugin",
    "notifications:send",
  ]);
  assert.deepEqual(schedulePlugin.defaultConfig, { reminder_poll_seconds: 30 });
  assert.deepEqual(schedulePlugin.validateConfig?.({ reminder_poll_seconds: 1 }), []);
  assert.deepEqual(schedulePlugin.validateConfig?.({ reminder_poll_seconds: 3_600 }), []);
  assert.deepEqual(schedulePlugin.validateConfig?.({ reminder_poll_seconds: 0 }), [
    "reminder_poll_seconds must be an integer from 1 to 3600",
  ]);
  assert.deepEqual(schedulePlugin.validateConfig?.({ reminder_poll_seconds: "30" }), [
    "reminder_poll_seconds must be an integer from 1 to 3600",
  ]);

  assert.deepEqual(schedulePlugin.migrations?.map(({ name }) => name), [
    "001_schedule_items_and_reminder_deliveries",
    "002_schedule_delivery_lookup_index",
  ]);
  const migration = schedulePlugin.migrations?.[0]?.sql ?? "";
  assert.match(migration, /schedule_items/);
  assert.match(migration, /schedule_reminder_deliveries/);
  assert.match(migration, /TIMESTAMPTZ/g);
  assert.match(migration, /CREATE UNIQUE INDEX[\s\S]*dedupe_key/);
  assert.match(migration, /version >= 1/);
  assert.match(migration, /status IN \('scheduled', 'active', 'done', 'cancelled'\)/);
  assert.doesNotMatch(migration, /calendar_events|records|inspiration/i);
  const lookupMigration = schedulePlugin.migrations?.[1]?.sql ?? "";
  assert.match(
    lookupMigration,
    /idx_schedule_reminder_deliveries_item_reminder/
  );
  assert.match(
    lookupMigration,
    /schedule_reminder_deliveries\(item_id, reminder_at\)/
  );

  const sources = ["index.ts", "reminders.ts", "routes.ts", "store.ts", "types.ts"]
    .map((name) => readFileSync(
      new URL(`../plugins/schedule/src/${name}`, import.meta.url),
      "utf8"
    ))
    .join("\n");
  assert.match(sources, /service<NotificationSend>\("notifications\.send"\)/);
  assert.doesNotMatch(sources, /core\/|notifier|inspiration|recordService/i);
});

test("Schedule boundary validation rejects local datetimes and unknown fields", () => {
  const valid = validateCreateScheduleItem({
    title: " Release ",
    scheduledStartAt: "2026-08-24T10:00:00+08:00",
    scheduledEndAt: "2026-08-24T11:00:00+08:00",
    timezone: "Asia/Shanghai",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.title, "Release");
    assert.equal(valid.value.nextReminderAt.toISOString(), "2026-08-24T02:00:00.000Z");
    assert.equal(valid.value.priority, 0);
  }

  const minutePrecision = validateCreateScheduleItem({
    title: "Minute precision",
    scheduledStartAt: "2026-08-24T10:00+08:00",
    timezone: "Asia/Shanghai",
  });
  assert.equal(minutePrecision.ok, true);
  if (minutePrecision.ok) {
    assert.equal(
      minutePrecision.value.scheduledStartAt.toISOString(),
      "2026-08-24T02:00:00.000Z"
    );
  }

  for (const invalid of [
    { title: "x", scheduledStartAt: "2026-08-24T10:00:00", timezone: "UTC" },
    { title: "x", scheduledStartAt: "2026-08-24T10:00.5Z", timezone: "UTC" },
    { title: "x", scheduledStartAt: "2026-08-24T10:00:00Z", timezone: "Mars/Base" },
    {
      title: "x",
      scheduledStartAt: "2026-08-24T10:00:00Z",
      scheduledEndAt: "2026-08-24T09:00:00Z",
      timezone: "UTC",
    },
    {
      title: "x",
      scheduledStartAt: "2026-08-24T10:00:00Z",
      timezone: "UTC",
      status: "active",
    },
  ]) {
    assert.equal(validateCreateScheduleItem(invalid).ok, false);
  }

  assert.deepEqual(validateEditScheduleItem({ expectedVersion: 1 }), {
    ok: false,
    error: "at least one editable field is required",
  });
  assert.equal(validateEditScheduleItem({
    expectedVersion: 1,
    nextReminderAt: null,
  }).ok, true);
  assert.equal(validateSnoozeBody({
    expectedVersion: 1,
    nextReminderAt: null,
  }).ok, false);
  assert.equal(validateListQuery({
    from: "2026-08-25T00:00:00Z",
    to: "2026-08-24T00:00:00Z",
  }).ok, false);
  assert.equal(validateListQuery({ status: "scheduled,active" }).ok, true);
  assert.equal(validateListQuery({ status: "scheduled,scheduled" }).ok, false);
});

test("awaitingConfirmation is derived and never persisted", () => {
  const base = {
    id: "schedule_001",
    title: "Release",
    description: null,
    scheduledStartAt: new Date("2026-08-24T02:00:00Z"),
    scheduledEndAt: null,
    timezone: "UTC",
    priority: 0,
    status: "scheduled" as const,
    nextReminderAt: null,
    confirmedStartAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: new Date("2026-08-24T00:00:00Z"),
    updatedAt: new Date("2026-08-24T00:00:00Z"),
  };
  assert.equal(
    scheduleItemFromRow(base, new Date("2026-08-24T01:59:59Z")).awaitingConfirmation,
    false
  );
  assert.equal(
    scheduleItemFromRow(base, new Date("2026-08-24T02:00:00Z")).awaitingConfirmation,
    true
  );
  assert.equal(
    scheduleItemFromRow(
      { ...base, status: "active", confirmedStartAt: new Date() },
      new Date("2026-08-24T03:00:00Z")
    ).awaitingConfirmation,
    false
  );
});

test("canonical routes preserve raw item arrays and structured conflicts", async () => {
  const current = item();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const fakeStore = {
    async list(filter: unknown) {
      calls.push({ method: "list", args: [filter] });
      return [current];
    },
    async create(input: unknown) {
      calls.push({ method: "create", args: [input] });
      return current;
    },
    async get(id: string) {
      return id === current.id ? current : null;
    },
    async edit() {
      return current;
    },
    async confirmStart(id: string, expectedVersion: number) {
      throw new ScheduleConflictError(id, expectedVersion, {
        currentVersion: 2,
        currentStatus: "active",
      });
    },
    async snooze() { return current; },
    async complete() { return current; },
    async cancel() { return current; },
    async listReminders() { return []; },
  };
  const routes = createScheduleRoutes(() => fakeStore as never);
  assert.deepEqual(routes.map(({ method, path }) => `${method} ${path}`), [
    "GET /api/plugins/schedule/items",
    "POST /api/plugins/schedule/items",
    "GET /api/plugins/schedule/items/:id",
    "PATCH /api/plugins/schedule/items/:id",
    "POST /api/plugins/schedule/items/:id/confirm-start",
    "POST /api/plugins/schedule/items/:id/snooze",
    "POST /api/plugins/schedule/items/:id/complete",
    "POST /api/plugins/schedule/items/:id/cancel",
    "GET /api/plugins/schedule/reminders",
  ]);
  assert.equal(routes.some(({ compatibilityAlias }) => compatibilityAlias), false);

  const list = routes[0]!;
  assert.deepEqual(await list.handler(request({
    query: {
      from: "2026-08-24T00:00:00Z",
      to: "2026-08-25T00:00:00Z",
      status: "scheduled,active",
    },
  }), signal), [current]);

  const create = routes[1]!;
  const created = await create.handler(request({ body: {
    title: "Release",
    scheduledStartAt: "2026-08-24T10:00:00+08:00",
    timezone: "Asia/Shanghai",
  } }), signal);
  assert.equal((created as { statusCode: number }).statusCode, 201);

  const confirm = routes[4]!;
  assert.deepEqual(await confirm.handler(request({
    params: { id: current.id },
    body: { expectedVersion: 1 },
  }), signal), {
    statusCode: 409,
    body: {
      error: `Schedule item ${current.id} has changed or cannot perform this action`,
      currentVersion: 2,
      currentStatus: "active",
    },
  });
  assert.deepEqual(await confirm.handler(request({
    params: { id: current.id },
    body: { expectedVersion: 1, automatic: true },
  }), signal), {
    statusCode: 400,
    body: { error: "unknown body field: automatic" },
  });
});

interface ReminderState {
  due: DueReminder[];
  deliveries: Map<string, ReminderDelivery>;
  terminalWrites: Array<{
    id: string;
    status: "sent" | "failed";
  }>;
}

class MemoryReminderStore {
  constructor(private readonly state: ReminderState) {}

  async dueReminders(): Promise<DueReminder[]> {
    return this.state.due;
  }

  async claimReminder(
    itemId: string,
    reminderAt: Date,
    _attemptedAt?: Date,
    signal?: AbortSignal
  ): Promise<ReminderDelivery | null> {
    signal?.throwIfAborted();
    const dedupeKey = reminderDedupeKey(itemId, reminderAt);
    if (this.state.deliveries.has(dedupeKey)) return null;
    const delivery: ReminderDelivery = {
      id: `delivery_${this.state.deliveries.size + 1}`,
      dedupeKey,
      itemId,
      reminderAt: reminderAt.toISOString(),
      attemptedAt: new Date().toISOString(),
      completedAt: null,
      status: "claimed",
      channelResults: null,
      failure: null,
    };
    this.state.deliveries.set(dedupeKey, delivery);
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
    this.state.terminalWrites.push({ id, status: input.status });
    const entry = [...this.state.deliveries.values()].find((value) => value.id === id);
    if (!entry || entry.status !== "claimed") throw new Error("not claimable");
    Object.assign(entry, input, { completedAt: new Date().toISOString() });
    return entry;
  }
}

function reminderState(): ReminderState {
  const scheduled = item();
  return {
    due: [{ item: scheduled, reminderAt: new Date(scheduled.nextReminderAt!) }],
    deliveries: new Map(),
    terminalWrites: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

test("reminder polling is at-most-once across repeat polls and store restarts", async () => {
  const state = reminderState();
  let sends = 0;
  const send = async () => {
    sends++;
    return {
      channels: {
        mac: { status: "sent" as const },
        ntfy: { status: "disabled" as const },
      },
    };
  };
  const first = await pollDueReminders(
    new MemoryReminderStore(state),
    send,
    signal
  );
  assert.deepEqual(first, {
    due: 1,
    claimed: 1,
    sent: 1,
    failed: 0,
    deduplicated: 0,
  });

  const afterRestart = await pollDueReminders(
    new MemoryReminderStore(state),
    send,
    signal
  );
  assert.equal(sends, 1);
  assert.equal(afterRestart.deduplicated, 1);
  assert.equal(state.due[0]!.item.status, "scheduled");
  assert.equal(state.due[0]!.item.version, 1);

  state.due[0] = {
    item: { ...state.due[0]!.item, nextReminderAt: "2026-08-24T02:30:00.000Z", version: 2 },
    reminderAt: new Date("2026-08-24T02:30:00.000Z"),
  };
  await pollDueReminders(new MemoryReminderStore(state), send, signal);
  assert.equal(sends, 2, "explicit snooze creates a new reminder instant/dedupe key");
  assert.equal(state.deliveries.size, 2);
});

test("reminder notifications render IANA wall time across offsets, DST, and invalid zones", async () => {
  const messageFor = async (scheduledStartAt: string, timezone: string) => {
    const state = reminderState();
    const scheduled = item({
      id: `schedule_${timezone}_${scheduledStartAt}`,
      scheduledStartAt,
      scheduledEndAt: null,
      timezone,
      nextReminderAt: scheduledStartAt,
    });
    state.due = [{ item: scheduled, reminderAt: new Date(scheduledStartAt) }];
    let message = "";
    await pollDueReminders(
      new MemoryReminderStore(state),
      async (request) => {
        message = request.message;
        return {
          channels: {
            mac: { status: "sent" },
            ntfy: { status: "disabled" },
          },
        };
      },
      signal
    );
    assert.equal(scheduled.scheduledStartAt, scheduledStartAt);
    return message;
  };

  const shanghai = await messageFor(
    "2026-08-24T01:00:00.000Z",
    "Asia/Shanghai"
  );
  assert.match(shanghai, /^Scheduled for 2026-08-24 09:00:00 \(Asia\/Shanghai\)\./);
  assert.equal(shanghai.includes("01:00:00.000Z (Asia/Shanghai)"), false);

  const beforeDst = await messageFor(
    "2026-03-08T06:30:00.000Z",
    "America/New_York"
  );
  const afterDst = await messageFor(
    "2026-03-08T07:30:00.000Z",
    "America/New_York"
  );
  assert.match(beforeDst, /2026-03-08 01:30:00 \(America\/New_York\)/);
  assert.match(afterDst, /2026-03-08 03:30:00 \(America\/New_York\)/);
  assert.equal(afterDst.includes("02:30:00"), false);

  const invalid = await messageFor(
    "2026-08-24T01:00:00.000Z",
    "Mars/Base"
  );
  assert.match(
    invalid,
    /2026-08-24 01:00:00 \(UTC; invalid timezone Mars\/Base\)/
  );
});

test("reminder polling terminalizes operational failures but retains caller-aborted claims", async () => {
  const disabled = reminderState();
  await pollDueReminders(new MemoryReminderStore(disabled), async () => ({
    channels: {
      mac: { status: "disabled" },
      ntfy: { status: "failed", error: "offline" },
    },
  }), signal);
  const disabledDelivery = [...disabled.deliveries.values()][0]!;
  assert.equal(disabledDelivery.status, "failed");
  assert.match(disabledDelivery.failure!, /mac: disabled/);
  assert.match(disabledDelivery.failure!, /ntfy: offline/);
  assert.deepEqual(disabled.terminalWrites.map(({ status }) => status), ["failed"]);

  const thrown = reminderState();
  await pollDueReminders(new MemoryReminderStore(thrown), async () => {
    throw new Error("notification provider unavailable");
  }, signal);
  assert.equal([...thrown.deliveries.values()][0]!.status, "failed");
  assert.equal(
    [...thrown.deliveries.values()][0]!.failure,
    "notification provider unavailable"
  );
  assert.deepEqual(thrown.terminalWrites.map(({ status }) => status), ["failed"]);

  const aborted = reminderState();
  const controller = new AbortController();
  await assert.rejects(
    pollDueReminders(new MemoryReminderStore(aborted), async (_request, sendSignal) => {
      controller.abort();
      sendSignal?.throwIfAborted();
      throw new Error("unreachable");
    }, controller.signal),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  const abortedDelivery = [...aborted.deliveries.values()][0]!;
  assert.equal(abortedDelivery.status, "claimed");
  assert.equal(abortedDelivery.completedAt, null);
  assert.deepEqual(aborted.terminalWrites, []);

  const abortError = reminderState();
  await assert.rejects(
    pollDueReminders(new MemoryReminderStore(abortError), async () => {
      throw Object.assign(new Error("notification caller aborted"), {
        name: "AbortError",
      });
    }, signal),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal([...abortError.deliveries.values()][0]!.status, "claimed");
  assert.deepEqual(abortError.terminalWrites, []);

  const preAborted = reminderState();
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    pollDueReminders(new MemoryReminderStore(preAborted), async () => {
      throw new Error("must not send");
    }, before.signal),
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(preAborted.deliveries.size, 0);
  assert.deepEqual(preAborted.terminalWrites, []);
});

test("reminder polling forwards caller abort through claim and ignores a late claim", async () => {
  const dueState = reminderState();
  const pending = deferred<ReminderDelivery | null>();
  const controller = new AbortController();
  let claimSignal: AbortSignal | undefined;
  let sends = 0;
  let terminalWrites = 0;
  const store: ReminderStore = {
    async dueReminders() {
      return dueState.due;
    },
    async claimReminder(_itemId, _reminderAt, _attemptedAt, signal) {
      claimSignal = signal;
      return pending.promise;
    },
    async finishReminder() {
      terminalWrites++;
      throw new Error("late claim must not finish a delivery");
    },
  };

  const polling = pollDueReminders(
    store,
    async () => {
      sends++;
      return {
        channels: {
          mac: { status: "sent" },
          ntfy: { status: "disabled" },
        },
      };
    },
    controller.signal
  );

  while (!claimSignal) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(claimSignal, controller.signal);
  controller.abort();
  pending.resolve({
    id: "late-claim",
    dedupeKey: "schedule:late",
    itemId: dueState.due[0]!.item.id,
    reminderAt: dueState.due[0]!.reminderAt.toISOString(),
    attemptedAt: new Date().toISOString(),
    completedAt: null,
    status: "claimed",
    channelResults: null,
    failure: null,
  });

  await assert.rejects(
    polling,
    (error) => error instanceof Error && error.name === "AbortError"
  );
  assert.equal(sends, 0);
  assert.equal(terminalWrites, 0);
});

test("internal claim transport timeout is distinct from caller abort", async () => {
  const timeout = Object.assign(
    new Error("schedule reminder claim timed out"),
    { name: "ScheduleClaimTimeoutError", code: "SCHEDULE_CLAIM_TIMEOUT" }
  );
  const controller = new AbortController();
  const state = reminderState();
  let sends = 0;
  const store: ReminderStore = {
    async dueReminders() {
      return state.due;
    },
    async claimReminder() {
      throw timeout;
    },
    async finishReminder() {
      throw new Error("claim timeout must not finish a delivery");
    },
  };
  await assert.rejects(
    pollDueReminders(
      store,
      async () => {
        sends++;
        return {
          channels: {
            mac: { status: "sent" },
            ntfy: { status: "disabled" },
          },
        };
      },
      controller.signal
    ),
    (error) => error === timeout
  );
  assert.equal(controller.signal.aborted, false);
  assert.equal(sends, 0);
});

test("Schedule registers one bounded Host job and cleans lifecycle state", async () => {
  let job: PluginJob | null = null;
  const context: PluginContext = {
    pluginId: "schedule",
    config: { reminder_poll_seconds: 7 },
    logger,
    registerRoute() {},
    registerJob(value) { job = value; },
    registerReportSection() {},
    async exec() { throw new Error("not used"); },
    service<T>(name: string): T {
      if (name === "database.url") return "postgres://localhost/unused" as T;
      if (name === "notifications.send") {
        return (async () => ({
          channels: {
            mac: { status: "disabled" },
            ntfy: { status: "disabled" },
          },
        })) as T;
      }
      throw new Error(`unexpected service ${name}`);
    },
  };
  await schedulePlugin.register?.(context);
  assert.equal(job?.id, "reminder-poll");
  assert.equal(job?.intervalMs, 7_000);
  assert.equal(job?.timeoutMs, SCHEDULE_REMINDER_JOB_TIMEOUT_MS);
  assert.ok(SCHEDULE_REMINDER_JOB_TIMEOUT_MS > job!.intervalMs);
  await schedulePlugin.stop?.(context, signal);
  await schedulePlugin.stop?.(context, signal);
});

test("disabled and missing-service Schedule states remain isolated", async () => {
  let migrations = 0;
  const disabled = new PluginHost({
    definitions: [schedulePlugin],
    configuration: { schedule: { enabled: false } },
    logger,
    migrationRunner: async () => { migrations++; },
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });
  await disabled.initialize();
  assert.equal(disabled.list()[0]?.state, "disabled");
  assert.equal(migrations, 0);
  await disabled.stop();

  const healthy: PluginDefinition = {
    manifest: manifest("healthy-after-schedule"),
    defaultEnabled: true,
  };
  const degraded = new PluginHost({
    definitions: [schedulePlugin, healthy],
    logger,
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    services: { "database.url": "postgres://localhost/unused" },
  });
  await degraded.initialize();
  assert.deepEqual(
    Object.fromEntries(degraded.list().map(({ id, state }) => [id, state])),
    { "healthy-after-schedule": "ready", schedule: "degraded" }
  );
  assert.match(degraded.list().find(({ id }) => id === "schedule")!.error!.message,
    /notifications\.send/);
  await degraded.stop();
});
