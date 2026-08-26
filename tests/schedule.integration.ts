import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import postgres from "postgres";
import { schedulePlugin } from "../plugins/schedule/src/index.js";
import { pollDueReminders } from "../plugins/schedule/src/reminders.js";
import {
  ScheduleClaimTimeoutError,
  ScheduleConflictError,
  ScheduleStore,
} from "../plugins/schedule/src/store.js";
import { PluginHost } from "../src/core/plugins/host.js";
import { createPluginMigrationRunner } from "../src/core/plugins/migrations.js";
import { pluginRoutes } from "../src/server/routes/plugins.js";

const testDatabaseUrl = process.env.ECHOLOG_TEST_DATABASE_URL;

function testSchemaName(): string {
  return `el_test_schedule_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function quoteTestSchema(schema: string): string {
  if (!/^el_test_schedule_\d+_[a-f0-9]{12}$/.test(schema)) {
    throw new Error("refusing to use a non-test schema");
  }
  return `"${schema}"`;
}

function databaseUrlForSchema(
  databaseUrl: string,
  schema: string,
  applicationName?: string
): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  if (applicationName) url.searchParams.set("application_name", applicationName);
  return url.toString();
}

interface HeldRowLock {
  release(): void;
  settled: Promise<void>;
}

interface TrackedAbortController {
  controller: AbortController;
  listenerCounts(): { added: number; removed: number };
}

function trackedAbortController(): TrackedAbortController {
  const controller = new AbortController();
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let added = 0;
  let removed = 0;

  Object.defineProperties(signal, {
    addEventListener: {
      configurable: true,
      value: ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        if (type === "abort") added++;
        return originalAdd(type, listener, options);
      }) as AbortSignal["addEventListener"],
    },
    removeEventListener: {
      configurable: true,
      value: ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions
      ) => {
        if (type === "abort") removed++;
        return originalRemove(type, listener, options);
      }) as AbortSignal["removeEventListener"],
    },
  });

  return {
    controller,
    listenerCounts: () => ({ added, removed }),
  };
}

async function holdScheduleItemLock(
  connection: ReturnType<typeof postgres>,
  itemId: string
): Promise<HeldRowLock> {
  let releaseLock!: () => void;
  let resolveLocked!: () => void;
  let rejectLocked!: (error: unknown) => void;
  let released = false;
  const releaseRequested = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const locked = new Promise<void>((resolve, reject) => {
    resolveLocked = resolve;
    rejectLocked = reject;
  });
  const settled = connection.begin(async (transaction) => {
    await transaction`
      SELECT id
      FROM schedule_items
      WHERE id = ${itemId}
      FOR UPDATE
    `;
    resolveLocked();
    await releaseRequested;
  });
  void settled.catch(rejectLocked);
  await locked;
  return {
    release() {
      if (released) return;
      released = true;
      releaseLock();
    },
    settled,
  };
}

async function waitForBlockedApplication(
  admin: ReturnType<typeof postgres>,
  applicationName: string
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const [activity] = await admin<{ blocked: number }[]>`
      SELECT COUNT(*)::integer AS blocked
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND state = 'active'
        AND wait_event_type = 'Lock'
    `;
    if ((activity?.blocked ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`claim connection ${applicationName} did not block on the row lock`);
}

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

test("schedule integration requires an explicit test database URL", () => {
  assert.ok(
    testDatabaseUrl,
    "set ECHOLOG_TEST_DATABASE_URL to run PostgreSQL integration tests"
  );
});

test(
  "Schedule rolls back blocked claims after internal timeout and caller abort",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    if (!testDatabaseUrl) return;
    const schema = testSchemaName();
    const quotedSchema = quoteTestSchema(schema);
    const scopedDatabaseUrl = databaseUrlForSchema(testDatabaseUrl, schema);
    const admin = postgres(testDatabaseUrl, { max: 1 });
    const locker = postgres(scopedDatabaseUrl, { max: 1 });
    const timeoutApplication = `el_schedule_timeout_${randomUUID().slice(0, 12)}`;
    const abortApplication = `el_schedule_abort_${randomUUID().slice(0, 12)}`;
    const timeoutStore = new ScheduleStore(
      databaseUrlForSchema(testDatabaseUrl, schema, timeoutApplication),
      { claimTimeoutMs: 250 }
    );
    const abortStore = new ScheduleStore(
      databaseUrlForSchema(testDatabaseUrl, schema, abortApplication),
      { claimTimeoutMs: 2_000 }
    );
    const observerStore = new ScheduleStore(scopedDatabaseUrl);
    const heldLocks: HeldRowLock[] = [];
    let schemaCreated = false;

    try {
      await admin.unsafe(`CREATE SCHEMA ${quotedSchema}`);
      schemaCreated = true;
      const migrationRunner = createPluginMigrationRunner(scopedDatabaseUrl);
      await migrationRunner("schedule", schedulePlugin.migrations ?? []);

      const dueAt = new Date("2026-08-26T01:00:00Z");
      const attemptedAt = new Date("2026-08-26T02:00:00Z");
      const successItem = await observerStore.create({
        title: "Bounded claim success cleanup",
        description: null,
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      });
      const successCaller = trackedAbortController();
      assert.ok(await observerStore.claimReminder(
        successItem.id,
        dueAt,
        attemptedAt,
        successCaller.controller.signal
      ));
      assert.equal(successCaller.controller.signal.aborted, false);
      assert.deepEqual(
        successCaller.listenerCounts(),
        { added: 1, removed: 1 },
        "a successful bounded claim must remove its caller abort listener"
      );

      const timeoutItem = await timeoutStore.create({
        title: "Blocked internal timeout",
        description: null,
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      });
      const timeoutLock = await holdScheduleItemLock(locker, timeoutItem.id);
      heldLocks.push(timeoutLock);
      const timeoutCaller = trackedAbortController();
      const timedOutClaim = timeoutStore.claimReminder(
        timeoutItem.id,
        dueAt,
        attemptedAt,
        timeoutCaller.controller.signal
      );
      await waitForBlockedApplication(admin, timeoutApplication);
      await assert.rejects(timedOutClaim, (error: unknown) => {
        assert.ok(error instanceof ScheduleClaimTimeoutError);
        assert.equal(error.code, "SCHEDULE_CLAIM_TIMEOUT");
        assert.equal(error.timeoutMs, 250);
        return true;
      });
      assert.equal(
        timeoutCaller.controller.signal.aborted,
        false,
        "an internal transport timeout must not abort the caller signal"
      );
      assert.deepEqual(
        timeoutCaller.listenerCounts(),
        { added: 1, removed: 1 },
        "an internal timeout must remove its caller abort listener"
      );
      timeoutLock.release();
      await timeoutLock.settled;
      await timeoutStore.close();
      assert.deepEqual(
        await observerStore.listReminders({ itemId: timeoutItem.id, limit: 10 }),
        [],
        "the late transaction must roll back instead of inserting a claim"
      );
      const unchangedAfterTimeout = await observerStore.get(timeoutItem.id);
      assert.equal(unchangedAfterTimeout?.status, "scheduled");
      assert.equal(unchangedAfterTimeout?.version, 1);

      const abortItem = await observerStore.create({
        title: "Blocked caller abort",
        description: null,
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      });
      const abortLock = await holdScheduleItemLock(locker, abortItem.id);
      heldLocks.push(abortLock);
      const abortCaller = trackedAbortController();
      const abortedClaim = abortStore.claimReminder(
        abortItem.id,
        dueAt,
        attemptedAt,
        abortCaller.controller.signal
      );
      await waitForBlockedApplication(admin, abortApplication);
      const abortReason = new DOMException("host stopped", "AbortError");
      abortCaller.controller.abort(abortReason);
      await assert.rejects(abortedClaim, (error: unknown) => error === abortReason);
      assert.deepEqual(
        abortCaller.listenerCounts(),
        { added: 1, removed: 1 },
        "caller abort must remove the bounded claim listener"
      );
      abortLock.release();
      await abortLock.settled;
      await abortStore.close();
      assert.deepEqual(
        await observerStore.listReminders({ itemId: abortItem.id, limit: 10 }),
        [],
        "caller abort must revoke the late transaction's claim authority"
      );
      const unchangedAfterAbort = await observerStore.get(abortItem.id);
      assert.equal(unchangedAfterAbort?.status, "scheduled");
      assert.equal(unchangedAfterAbort?.version, 1);
    } finally {
      for (const lock of heldLocks) lock.release();
      await Promise.allSettled(heldLocks.map(({ settled }) => settled));
      await abortStore.close();
      await timeoutStore.close();
      await observerStore.close();
      await locker.end();
      if (schemaCreated) await admin.unsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
      await admin.end();
    }
  }
);

test(
  "Schedule persists CAS transitions, range routes, and at-most-once reminder ledgers",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    if (!testDatabaseUrl) return;
    const schema = testSchemaName();
    const quotedSchema = quoteTestSchema(schema);
    const scopedDatabaseUrl = databaseUrlForSchema(testDatabaseUrl, schema);
    const admin = postgres(testDatabaseUrl, { max: 1 });
    let schemaCreated = false;
    let firstStore: ScheduleStore | null = null;
    let secondStore: ScheduleStore | null = null;
    let restartedStore: ScheduleStore | null = null;
    let drainRestartStore: ScheduleStore | null = null;
    let host: PluginHost | null = null;
    let app: ReturnType<typeof Fastify> | null = null;

    try {
      await admin.unsafe(`CREATE SCHEMA ${quotedSchema}`);
      schemaCreated = true;
      const migrationRunner = createPluginMigrationRunner(scopedDatabaseUrl);
      const migrations = schedulePlugin.migrations ?? [];
      await migrationRunner("schedule", migrations);
      await migrationRunner("schedule", migrations);

      firstStore = new ScheduleStore(scopedDatabaseUrl);
      secondStore = new ScheduleStore(scopedDatabaseUrl);
      const originalDefaultStart = new Date("2026-08-27T10:00:00Z");
      const movedDefaultStart = new Date("2026-08-27T11:00:00Z");
      const defaultReminder = await firstStore.create({
        title: "Default reminder follows start",
        description: null,
        scheduledStartAt: originalDefaultStart,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: originalDefaultStart,
      });
      const movedDefault = await firstStore.edit(defaultReminder.id, 1, {
        scheduledStartAt: movedDefaultStart,
      });
      assert.equal(movedDefault.scheduledStartAt, movedDefaultStart.toISOString());
      assert.equal(movedDefault.nextReminderAt, movedDefaultStart.toISOString());

      const customReminderAt = new Date("2026-08-27T09:30:00Z");
      const customReminder = await firstStore.create({
        title: "Custom reminder stays fixed",
        description: null,
        scheduledStartAt: originalDefaultStart,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: customReminderAt,
      });
      const movedCustom = await firstStore.edit(customReminder.id, 1, {
        scheduledStartAt: movedDefaultStart,
      });
      assert.equal(movedCustom.scheduledStartAt, movedDefaultStart.toISOString());
      assert.equal(movedCustom.nextReminderAt, customReminderAt.toISOString());

      const explicitReminder = await firstStore.create({
        title: "Explicit edit reminder wins",
        description: null,
        scheduledStartAt: originalDefaultStart,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: originalDefaultStart,
      });
      const explicitEditedReminderAt = new Date("2026-08-27T10:45:00Z");
      const movedExplicit = await firstStore.edit(explicitReminder.id, 1, {
        scheduledStartAt: movedDefaultStart,
        nextReminderAt: explicitEditedReminderAt,
      });
      assert.equal(movedExplicit.scheduledStartAt, movedDefaultStart.toISOString());
      assert.equal(
        movedExplicit.nextReminderAt,
        explicitEditedReminderAt.toISOString()
      );

      const plannedStart = new Date("2026-08-24T02:00:00Z");
      const concurrent = await firstStore.create({
        title: "Concurrent confirmation",
        description: null,
        scheduledStartAt: plannedStart,
        scheduledEndAt: new Date("2026-08-24T03:00:00Z"),
        timezone: "Asia/Shanghai",
        priority: 1,
        nextReminderAt: plannedStart,
      }, new Date("2026-08-24T00:00:00Z"));
      const confirmationBefore = new Date();
      const [left, right] = await Promise.allSettled([
        firstStore.confirmStart(concurrent.id, 1),
        secondStore.confirmStart(concurrent.id, 1),
      ]);
      const fulfilled = [left, right].filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<ScheduleStore["confirmStart"]>>> =>
          result.status === "fulfilled"
      );
      const rejected = [left, right].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(rejected[0]!.reason instanceof ScheduleConflictError);
      assert.deepEqual(rejected[0]!.reason.metadata, {
        currentVersion: 2,
        currentStatus: "active",
      });
      const winner = fulfilled[0]!.value;
      assert.equal(winner.status, "active");
      assert.equal(winner.version, 2);
      assert.equal(winner.nextReminderAt, null);
      assert.notEqual(winner.confirmedStartAt, concurrent.scheduledStartAt);
      assert.ok(new Date(winner.confirmedStartAt!).getTime() >= confirmationBefore.getTime());

      const dueAt = new Date("2026-08-24T01:00:00Z");
      const reminderItem = await firstStore.create({
        title: "Reminder only",
        description: "Do not start automatically",
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      }, new Date("2026-08-24T00:00:00Z"));
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
      const pollAt = new Date("2026-08-24T02:00:00Z");
      await pollDueReminders(firstStore, send, new AbortController().signal, {
        now: pollAt,
      });
      await pollDueReminders(firstStore, send, new AbortController().signal, {
        now: pollAt,
      });
      restartedStore = new ScheduleStore(scopedDatabaseUrl);
      await pollDueReminders(restartedStore, send, new AbortController().signal, {
        now: pollAt,
      });
      assert.equal(sends, 1);
      assert.equal((await restartedStore.listReminders({
        itemId: reminderItem.id,
        limit: 10,
      })).length, 1);
      const stillScheduled = await restartedStore.get(reminderItem.id, pollAt);
      assert.equal(stillScheduled?.status, "scheduled");
      assert.equal(stillScheduled?.version, 1);
      assert.equal(stillScheduled?.confirmedStartAt, null);

      const snoozedAt = new Date("2026-08-24T01:30:00Z");
      await restartedStore.snooze(reminderItem.id, 1, snoozedAt, pollAt);
      await pollDueReminders(restartedStore, send, new AbortController().signal, {
        now: pollAt,
      });
      assert.equal(sends, 2);
      assert.equal((await restartedStore.listReminders({
        itemId: reminderItem.id,
        limit: 10,
      })).length, 2);

      const drainItemIds = new Set((await Promise.all(
        Array.from({ length: 105 }, (_, index) => firstStore!.create({
          title: `Drain reminder ${String(index + 1).padStart(3, "0")}`,
          description: null,
          scheduledStartAt: dueAt,
          scheduledEndAt: null,
          timezone: "UTC",
          priority: 0,
          nextReminderAt: dueAt,
        }, new Date("2026-08-24T00:00:00Z")))
      )).map(({ id }) => id));
      let drainSends = 0;
      const drainSend = async () => {
        drainSends++;
        return {
          channels: {
            mac: { status: "sent" as const },
            ntfy: { status: "disabled" as const },
          },
        };
      };
      const firstDrain = await pollDueReminders(
        firstStore,
        drainSend,
        new AbortController().signal,
        { now: pollAt, limit: 100 }
      );
      assert.deepEqual({
        due: firstDrain.due,
        claimed: firstDrain.claimed,
        sent: firstDrain.sent,
      }, { due: 100, claimed: 100, sent: 100 });

      drainRestartStore = new ScheduleStore(scopedDatabaseUrl);
      const afterDrainRestart = await pollDueReminders(
        drainRestartStore,
        drainSend,
        new AbortController().signal,
        { now: pollAt, limit: 100 }
      );
      assert.deepEqual({
        due: afterDrainRestart.due,
        claimed: afterDrainRestart.claimed,
        sent: afterDrainRestart.sent,
      }, { due: 5, claimed: 5, sent: 5 });
      const drainedAgain = await pollDueReminders(
        drainRestartStore,
        drainSend,
        new AbortController().signal,
        { now: pollAt, limit: 100 }
      );
      assert.equal(drainedAgain.due, 0);
      assert.equal(drainSends, 105);
      const drainLedgers = (await drainRestartStore.listReminders({ limit: 500 }))
        .filter(({ itemId }) => drainItemIds.has(itemId));
      assert.equal(drainLedgers.length, 105);
      assert.equal(new Set(drainLedgers.map(({ dedupeKey }) => dedupeKey)).size, 105);

      const failedItem = await firstStore.create({
        title: "Failed notification remains scheduled",
        description: null,
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      });
      await pollDueReminders(firstStore, async () => ({
        channels: {
          mac: { status: "disabled" },
          ntfy: { status: "failed", error: "offline" },
        },
      }), new AbortController().signal, { now: pollAt });
      const failedLedger = await firstStore.listReminders({
        itemId: failedItem.id,
        limit: 10,
      });
      assert.equal(failedLedger[0]?.status, "failed");
      assert.equal((await firstStore.get(failedItem.id))?.status, "scheduled");
      assert.equal(
        (await firstStore.dueReminders(pollAt, 500))
          .some(({ item }) => item.id === failedItem.id),
        false,
        "failed ledgers must not re-enter a later due batch"
      );

      const crashWindowItem = await firstStore.create({
        title: "Claimed before daemon crash",
        description: null,
        scheduledStartAt: dueAt,
        scheduledEndAt: null,
        timezone: "UTC",
        priority: 0,
        nextReminderAt: dueAt,
      });
      assert.ok(await firstStore.claimReminder(crashWindowItem.id, dueAt, pollAt));
      assert.equal(
        (await drainRestartStore.dueReminders(pollAt, 500))
          .some(({ item }) => item.id === crashWindowItem.id),
        false,
        "an unfinished claimed ledger must remain at-most-once after restart"
      );

      host = new PluginHost({
        definitions: [schedulePlugin],
        logger,
        migrationRunner,
        commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        services: {
          "database.url": scopedDatabaseUrl,
          "notifications.send": send,
        },
      });
      await host.initialize();
      assert.equal(host.list()[0]?.state, "ready");
      app = Fastify({ logger: false });
      await pluginRoutes(app, host);

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/plugins/schedule/items",
        payload: {
          title: "HTTP race",
          scheduledStartAt: "2026-08-25T10:00:00+08:00",
          scheduledEndAt: "2026-08-25T11:00:00+08:00",
          timezone: "Asia/Shanghai",
        },
      });
      assert.equal(createResponse.statusCode, 201);
      const httpItem = createResponse.json();
      assert.equal(httpItem.version, 1);
      assert.equal(httpItem.status, "scheduled");

      const [firstConfirm, secondConfirm] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/plugins/schedule/items/${httpItem.id}/confirm-start`,
          payload: { expectedVersion: 1 },
        }),
        app.inject({
          method: "POST",
          url: `/api/plugins/schedule/items/${httpItem.id}/confirm-start`,
          payload: { expectedVersion: 1 },
        }),
      ]);
      assert.deepEqual(
        [firstConfirm.statusCode, secondConfirm.statusCode].sort(),
        [200, 409]
      );
      const conflict = [firstConfirm, secondConfirm].find(
        (response) => response.statusCode === 409
      )!.json();
      assert.deepEqual({
        currentVersion: conflict.currentVersion,
        currentStatus: conflict.currentStatus,
      }, { currentVersion: 2, currentStatus: "active" });

      const rangeResponse = await app.inject({
        method: "GET",
        url: "/api/plugins/schedule/items?from=2026-08-25T00%3A00%3A00Z&to=2026-08-26T00%3A00%3A00Z&status=active",
      });
      assert.equal(rangeResponse.statusCode, 200, rangeResponse.body);
      assert.equal(Array.isArray(rangeResponse.json()), true);
      assert.equal(rangeResponse.json().some(({ id }: { id: string }) => id === httpItem.id), true);
    } finally {
      await app?.close();
      await host?.stop();
      await drainRestartStore?.close();
      await restartedStore?.close();
      await secondStore?.close();
      await firstStore?.close();
      if (schemaCreated) await admin.unsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
      await admin.end();
    }
  }
);
