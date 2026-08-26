import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import {
  FLOW_RESERVATION_LEASE_MS,
  FLOW_UNKNOWN_DISPATCH_ERROR,
  FlowStore,
  FlowStoreError,
} from "../plugins/inspiration/src/flow-store.js";
import { FlowService } from "../plugins/inspiration/src/flow.js";
import { migrations } from "../plugins/inspiration/src/migrations.js";
import {
  decodeDeliveryCursor,
  encodeDeliveryCursor,
  type DeliveryCursor,
} from "../plugins/inspiration/src/pagination.js";
import {
  InspirationStore,
  InspirationStoreError,
} from "../plugins/inspiration/src/store.js";
import type { FlowSettingsUpdate } from "../plugins/inspiration/src/types.js";
import { createPluginMigrationRunner } from "../src/core/plugins/migrations.js";

const testDatabaseUrl = process.env.ECHOLOG_TEST_DATABASE_URL;

function testSchemaName(): string {
  return `el_test_inspiration_${process.pid}_${randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}`;
}

function quoteTestSchema(schema: string): string {
  if (!/^el_test_inspiration_\d+_[a-f0-9]{12}$/.test(schema)) {
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

interface IntegrationFixture {
  admin: ReturnType<typeof postgres>;
  databaseUrl: string;
}

async function withIntegrationSchema(
  run: (fixture: IntegrationFixture) => Promise<void>
): Promise<void> {
  if (!testDatabaseUrl) return;
  const schema = testSchemaName();
  const quotedSchema = quoteTestSchema(schema);
  const scopedDatabaseUrl = databaseUrlForSchema(testDatabaseUrl, schema);
  const admin = postgres(testDatabaseUrl, { max: 1 });
  let schemaCreated = false;
  try {
    await admin.unsafe(`CREATE SCHEMA ${quotedSchema}`);
    schemaCreated = true;
    const migrationRunner = createPluginMigrationRunner(scopedDatabaseUrl);
    await migrationRunner("inspiration", migrations);
    await migrationRunner("inspiration", migrations);
    await run({ admin, databaseUrl: scopedDatabaseUrl });
  } finally {
    if (schemaCreated) await admin.unsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
    await admin.end();
  }
}

async function configureFlow(
  store: FlowStore,
  overrides: Partial<Omit<FlowSettingsUpdate, "expectedVersion">> = {}
) {
  const current = await store.getSettings();
  const input: FlowSettingsUpdate = {
    expectedVersion: current.version,
    enabled: true,
    intervalMinutes: 60,
    quietStartMinute: 0,
    quietEndMinute: 0,
    cooldownMinutes: 0,
    dailyLimit: 100,
    defaultSnoozeMinutes: 120,
    statuses: ["inbox", "kept"],
    tags: [],
    projects: [],
    ...overrides,
  };
  const updated = await store.updateSettings(input);
  assert.ok(updated);
  assert.equal(updated.version, current.version + 1);
  return updated;
}

async function waitForDatabaseLock(
  admin: ReturnType<typeof postgres>,
  applicationName: string
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await admin<{ waiting: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS waiting
    `;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`database client ${applicationName} never entered a lock wait`);
}

test("inspiration integration requires an explicit test database URL", () => {
  assert.ok(
    testDatabaseUrl,
    "set ECHOLOG_TEST_DATABASE_URL to run PostgreSQL integration tests"
  );
});

test(
  "real PostgreSQL preserves optimistic writes, atomic dedupe, and snooze isolation",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => withIntegrationSchema(async ({ databaseUrl }) => {
    const captureA = new InspirationStore(databaseUrl);
    const captureB = new InspirationStore(databaseUrl);
    const flowA = new FlowStore(databaseUrl);
    const flowB = new FlowStore(databaseUrl);
    try {
      const first = await captureA.create({
        content: "first durable idea",
        tags: ["flow"],
        project: "EchoLog",
        status: "inbox",
      });
      const writes = await Promise.allSettled([
        captureA.update(first.id, {
          expectedVersion: first.version,
          content: "winner A",
        }),
        captureB.update(first.id, {
          expectedVersion: first.version,
          content: "winner B",
        }),
      ]);
      assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = writes.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.ok(rejected.reason instanceof InspirationStoreError);
      assert.equal(rejected.reason.code, "INSPIRATION_VERSION_CONFLICT");

      await captureA.create({
        content: "second durable idea",
        tags: ["flow"],
        project: "EchoLog",
        status: "inbox",
      });
      await configureFlow(flowA);

      const now = new Date("2026-08-24T08:00:00.000Z");
      const reservations = await Promise.all([
        flowA.reserveNext("manual", "manual:postgres-race", now),
        flowB.reserveNext("manual", "manual:postgres-race", now),
      ]);
      assert.equal(reservations.filter((result) => result.shouldNotify).length, 1);
      assert.equal(
        new Set(reservations.map((result) => result.candidate?.delivery.id)).size,
        1
      );
      const owner = reservations.find((result) => result.shouldNotify);
      assert.ok(owner?.candidate);
      const dispatching = await flowA.claimNotification(
        owner.candidate.delivery.id,
        owner.candidate.delivery.version,
        now
      );
      assert.equal(dispatching.status, "dispatching");
      const sent = await flowA.finalizeNotification(
        dispatching.id,
        dispatching.version,
        {
          delivered: true,
          channels: {
            mac: { status: "sent" },
            ntfy: { status: "disabled" },
          },
          at: now,
        }
      );
      assert.equal(sent.status, "sent");
      assert.equal(sent.attempts, 1);
      const sentFromLedger = (await flowB.listDeliveries()).deliveries.find(
        (item) => item.id === sent.id
      );
      assert.deepEqual(sentFromLedger?.notificationChannels, {
        mac: { status: "sent" },
        ntfy: { status: "disabled" },
      });

      const statusBeforeLater = owner.candidate.inspiration.status;
      const later = await flowA.applyOutcome(
        sent.id,
        sent.version,
        owner.candidate.inspiration.version,
        "later",
        new Date(now.getTime() + 120 * 60_000),
        now
      );
      assert.equal(later.delivery.outcome, "later");
      assert.equal(later.inspiration.status, statusBeforeLater);
      assert.equal(
        later.inspiration.version,
        owner.candidate.inspiration.version,
        "later must not mutate inspiration lifecycle/version"
      );
    } finally {
      await Promise.all([
        captureA.close(),
        captureB.close(),
        flowA.close(),
        flowB.close(),
      ]);
    }
  })
);

test(
  "external notification success followed by interruption is terminalized without resend after reopen",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => withIntegrationSchema(async ({ databaseUrl }) => {
    const capture = new InspirationStore(databaseUrl);
    let firstStore: FlowStore | null = new FlowStore(databaseUrl);
    let reopenedStore: FlowStore | null = null;
    try {
      await capture.create({
        content: "at-most-once external notification",
        tags: ["reliability"],
        project: "EchoLog",
        status: "inbox",
      });
      await configureFlow(firstStore);

      const dispatchedAt = new Date("2026-08-24T09:00:00.000Z");
      const controller = new AbortController();
      let externalSends = 0;
      const notificationKeys: Array<string | undefined> = [];
      const interruptedService = new FlowService(
        firstStore,
        () => async (request) => {
          externalSends += 1;
          notificationKeys.push(request.dedupeKey);
          // Model an external transport that succeeded just before the daemon
          // was interrupted, so DB finalization never runs.
          controller.abort();
          return {
            channels: {
              mac: { status: "sent" },
              ntfy: { status: "disabled" },
            },
          };
        },
        () => dispatchedAt
      );
      await assert.rejects(
        interruptedService.nextManual("crash-after-send", controller.signal),
        (error) => error instanceof Error && error.name === "AbortError"
      );
      assert.equal(externalSends, 1);
      const beforeRestart = await firstStore.listDeliveries();
      assert.equal(beforeRestart.deliveries.length, 1);
      const original = beforeRestart.deliveries[0]!;
      assert.equal(original.status, "dispatching");
      assert.deepEqual(notificationKeys, [
        `inspiration:${original.dedupeKey}`,
      ]);

      await firstStore.close();
      firstStore = null;
      reopenedStore = new FlowStore(databaseUrl);
      let clock = new Date(
        dispatchedAt.getTime() + FLOW_RESERVATION_LEASE_MS + 1
      );
      let nextNotification: "failed" | "sent" = "failed";
      const restartedService = new FlowService(
        reopenedStore,
        () => async (request) => {
          externalSends += 1;
          notificationKeys.push(request.dedupeKey);
          return nextNotification === "sent"
            ? {
                channels: {
                  mac: { status: "sent" },
                  ntfy: { status: "disabled" },
                },
              }
            : {
                channels: {
                  mac: { status: "disabled" },
                  ntfy: { status: "failed", error: "transport unavailable" },
                },
              };
        },
        () => clock
      );

      const recovered = await restartedService.nextManual("crash-after-send");
      assert.equal(externalSends, 1, "the original ledger row must never be sent twice");
      assert.equal(recovered.shouldNotify, false);
      assert.equal(recovered.candidate?.delivery.id, original.id);
      assert.equal(recovered.candidate?.delivery.status, "failed");
      assert.equal(recovered.candidate?.delivery.error, FLOW_UNKNOWN_DISPATCH_ERROR);
      assert.deepEqual(recovered.explanation, [
        "recovery:interrupted-dispatch-unknown",
      ]);

      clock = new Date(clock.getTime() + 1_000);
      const explicitFailure = await restartedService.nextManual("explicit-failure");
      assert.equal(externalSends, 2);
      assert.equal(explicitFailure.candidate?.delivery.status, "failed");
      assert.ok(explicitFailure.candidate);
      assert.notEqual(explicitFailure.candidate?.delivery.id, original.id);
      assert.equal(
        notificationKeys.at(-1),
        `inspiration:${explicitFailure.candidate.delivery.dedupeKey}`
      );

      clock = new Date(clock.getTime() + 1_000);
      const duplicateFailure = await restartedService.nextManual("explicit-failure");
      assert.equal(
        externalSends,
        2,
        "a duplicate failed delivery must not call notifications.send again"
      );
      assert.equal(duplicateFailure.shouldNotify, false);
      assert.equal(
        duplicateFailure.candidate?.delivery.id,
        explicitFailure.candidate?.delivery.id
      );
      assert.equal(
        duplicateFailure.candidate?.delivery.dedupeKey,
        explicitFailure.candidate?.delivery.dedupeKey
      );

      nextNotification = "sent";
      clock = new Date(clock.getTime() + 1_000);
      const retry = await restartedService.nextManual("later-policy-bucket");
      assert.equal(externalSends, 3);
      assert.equal(retry.candidate?.delivery.status, "sent");
      assert.ok(retry.candidate);
      assert.notEqual(
        retry.candidate.delivery.id,
        explicitFailure.candidate.delivery.id,
        "an explicit failure may be selected again only as a distinct attempt"
      );
      assert.equal(
        notificationKeys.at(-1),
        `inspiration:${retry.candidate.delivery.dedupeKey}`
      );
      assert.notEqual(
        retry.candidate.delivery.dedupeKey,
        explicitFailure.candidate.delivery.dedupeKey
      );
      assert.equal(notificationKeys.length, 3);
      assert.equal(new Set(notificationKeys).size, notificationKeys.length);
    } finally {
      await capture.close();
      await firstStore?.close();
      await reopenedStore?.close();
    }
  })
);

test(
  "scheduled reservation derives its key from the locked updated settings snapshot",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => withIntegrationSchema(async ({ admin, databaseUrl }) => {
    const applicationName = `el_insp_wait_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const waiterUrl = new URL(databaseUrl);
    waiterUrl.searchParams.set("application_name", applicationName);
    const capture = new InspirationStore(databaseUrl);
    const waiter = new FlowStore(waiterUrl.toString());
    const blocker = postgres(databaseUrl, { max: 1 });
    let releaseSettingsLock!: () => void;
    let lockAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      lockAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSettingsLock = resolve;
    });
    let heldLock: Promise<unknown> | null = null;
    try {
      await capture.create({
        content: "settings snapshot race",
        tags: ["race"],
        project: "EchoLog",
        status: "inbox",
      });
      const oldSettings = await configureFlow(waiter, { intervalMinutes: 60 });
      const newVersion = oldSettings.version + 1;
      const newInterval = 90;
      heldLock = blocker.begin(async (transaction) => {
        await transaction`
          SELECT id FROM inspiration_flow_settings
          WHERE id = 'default'
          FOR UPDATE
        `;
        lockAcquired();
        await release;
        await transaction`
          UPDATE inspiration_flow_settings
          SET version = version + 1,
              interval_minutes = ${newInterval},
              updated_at = NOW()
          WHERE id = 'default'
        `;
      });
      await acquired;

      const now = new Date("2026-08-24T12:34:56.000Z");
      const reservation = waiter.reserveNext("scheduled", undefined, now);
      await waitForDatabaseLock(admin, applicationName);
      releaseSettingsLock();
      await heldLock;
      heldLock = null;

      const result = await reservation;
      assert.ok(result.candidate);
      assert.equal(result.shouldNotify, true);
      const bucket = Math.floor(now.getTime() / (newInterval * 60_000));
      assert.equal(
        result.candidate.delivery.dedupeKey,
        `scheduled:${newVersion}:${newInterval}:${bucket}`
      );
      const persisted = await waiter.getSettings();
      assert.equal(persisted.version, newVersion);
      assert.equal(persisted.intervalMinutes, newInterval);
    } finally {
      releaseSettingsLock?.();
      await heldLock?.catch(() => undefined);
      await Promise.all([capture.close(), waiter.close(), blocker.end()]);
    }
  })
);

test(
  "delivery composite cursors traverse equal timestamps without skips or duplicates",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => withIntegrationSchema(async ({ databaseUrl }) => {
    const capture = new InspirationStore(databaseUrl);
    const flow = new FlowStore(databaseUrl);
    const control = postgres(databaseUrl, { max: 1 });
    try {
      const inspiration = await capture.create({
        content: "pagination anchor",
        tags: ["pagination"],
        project: "EchoLog",
        status: "inbox",
      });
      const equalAt = new Date("2026-08-24T09:00:00.000Z");
      const seeded = [
        { id: "pg_later", surfacedAt: new Date("2026-08-24T10:00:00.000Z") },
        ...["pg_equal_01", "pg_equal_02", "pg_equal_03", "pg_equal_04", "pg_equal_05", "pg_equal_06"]
          .map((id) => ({ id, surfacedAt: equalAt })),
        { id: "pg_earlier", surfacedAt: new Date("2026-08-24T08:00:00.000Z") },
      ];
      for (const row of seeded) {
        await control`
          INSERT INTO inspiration_flow_deliveries (
            id, inspiration_id, source, dedupe_key, status, surfaced_at,
            error, created_at, updated_at
          ) VALUES (
            ${row.id}, ${inspiration.id}, 'manual', ${`seed:${row.id}`},
            'failed', ${row.surfacedAt}, 'seed failure',
            ${row.surfacedAt}, ${row.surfacedAt}
          )
        `;
      }

      const expected = [...seeded]
        .sort((left, right) => {
          const byTime = right.surfacedAt.getTime() - left.surfacedAt.getTime();
          if (byTime !== 0) return byTime;
          return left.id === right.id ? 0 : left.id < right.id ? 1 : -1;
        })
        .map((row) => row.id);
      const traversed: string[] = [];
      const opaqueCursors: string[] = [];
      let cursor: DeliveryCursor | undefined;
      for (;;) {
        const page = await flow.listDeliveries(3, cursor);
        traversed.push(...page.deliveries.map((delivery) => delivery.id));
        if (!page.nextCursor) break;
        const opaque = encodeDeliveryCursor(page.nextCursor);
        opaqueCursors.push(opaque);
        const decoded = decodeDeliveryCursor(opaque);
        assert.ok(decoded);
        assert.equal(decoded.id, page.nextCursor.id);
        assert.equal(
          decoded.surfacedAt.toISOString(),
          page.nextCursor.surfacedAt.toISOString()
        );
        cursor = decoded;
      }

      assert.ok(opaqueCursors.length >= 2, "equal timestamps must cross page boundaries");
      assert.deepEqual(traversed, expected);
      assert.equal(new Set(traversed).size, traversed.length);

      const equalTimestampBoundary = await flow.listDeliveries(20, {
        surfacedAt: equalAt,
        id: "pg_equal_04",
      });
      assert.deepEqual(
        equalTimestampBoundary.deliveries.map((delivery) => delivery.id),
        ["pg_equal_03", "pg_equal_02", "pg_equal_01", "pg_earlier"]
      );
      assert.equal(equalTimestampBoundary.nextCursor, null);

      const afterLast = await flow.listDeliveries(3, {
        surfacedAt: new Date("2026-08-24T08:00:00.000Z"),
        id: "pg_earlier",
      });
      assert.deepEqual(afterLast.deliveries, []);
      assert.equal(afterLast.nextCursor, null);
    } finally {
      await Promise.all([capture.close(), flow.close(), control.end()]);
    }
  })
);

test(
  "manual and scheduled failed deliveries are terminal and reject outcomes",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => withIntegrationSchema(async ({ databaseUrl }) => {
    const capture = new InspirationStore(databaseUrl);
    const flow = new FlowStore(databaseUrl);
    try {
      await capture.create({
        content: "failed outcome source boundary",
        tags: ["outcome"],
        project: "EchoLog",
        status: "inbox",
      });
      await configureFlow(flow);
      let now = new Date("2026-08-24T14:00:00.000Z");
      let sends = 0;
      const service = new FlowService(
        flow,
        () => async () => {
          sends += 1;
          return {
            channels: {
              mac: { status: "disabled" },
              ntfy: { status: "failed", error: "transport unavailable" },
            },
          };
        },
        () => now
      );

      const manual = await service.nextManual("manual-failed-outcome");
      assert.equal(manual.candidate?.delivery.status, "failed");
      assert.equal(manual.candidate?.delivery.source, "manual");
      assert.ok(manual.candidate);
      await assert.rejects(
        service.applyOutcome(manual.candidate.delivery.id, {
          expectedDeliveryVersion: manual.candidate.delivery.version,
          expectedInspirationVersion: manual.candidate.inspiration.version,
          outcome: "viewed",
        }),
        (error) => error instanceof FlowStoreError && error.code === "INVALID_STATE"
      );
      const manualLedger = (await flow.listDeliveries()).deliveries.find(
        (delivery) => delivery.id === manual.candidate?.delivery.id
      );
      assert.equal(manualLedger?.status, "failed");
      assert.equal(manualLedger?.outcome, null);
      assert.equal(manualLedger?.outcomeAt, null);

      now = new Date(now.getTime() + 60 * 60_000);
      const scheduled = await service.runScheduled(new AbortController().signal);
      assert.equal(scheduled.candidate?.delivery.status, "failed");
      assert.equal(scheduled.candidate?.delivery.source, "scheduled");
      assert.ok(scheduled.candidate);
      await assert.rejects(
        service.applyOutcome(scheduled.candidate.delivery.id, {
          expectedDeliveryVersion: scheduled.candidate.delivery.version,
          expectedInspirationVersion: scheduled.candidate.inspiration.version,
          outcome: "viewed",
        }),
        (error) => error instanceof FlowStoreError && error.code === "INVALID_STATE"
      );
      const scheduledLedger = (await flow.listDeliveries()).deliveries.find(
        (delivery) => delivery.id === scheduled.candidate?.delivery.id
      );
      assert.equal(scheduledLedger?.status, "failed");
      assert.equal(scheduledLedger?.outcome, null);
      assert.equal(scheduledLedger?.outcomeAt, null);
      assert.equal(sends, 2);
    } finally {
      await Promise.all([capture.close(), flow.close()]);
    }
  })
);
