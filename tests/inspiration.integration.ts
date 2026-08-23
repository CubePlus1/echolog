import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { FlowStore } from "../plugins/inspiration/src/flow-store.js";
import { migrations } from "../plugins/inspiration/src/migrations.js";
import {
  InspirationStore,
  InspirationStoreError,
} from "../plugins/inspiration/src/store.js";
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

function databaseUrlForSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

test("inspiration integration requires an explicit test database URL", () => {
  assert.ok(
    testDatabaseUrl,
    "set ECHOLOG_TEST_DATABASE_URL to run PostgreSQL integration tests"
  );
});

test(
  "real PostgreSQL enforces optimistic writes, atomic dedupe, snooze isolation, and cross-bucket recovery",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    if (!testDatabaseUrl) return;

    const schema = testSchemaName();
    const quotedSchema = quoteTestSchema(schema);
    const scopedDatabaseUrl = databaseUrlForSchema(testDatabaseUrl, schema);
    const admin = postgres(testDatabaseUrl, { max: 1 });
    const blocker = postgres(scopedDatabaseUrl, { max: 1 });
    const captureStores: InspirationStore[] = [];
    const flowStores: FlowStore[] = [];
    let schemaCreated = false;

    try {
      await admin.unsafe(`CREATE SCHEMA ${quotedSchema}`);
      schemaCreated = true;
      const migrationRunner = createPluginMigrationRunner(scopedDatabaseUrl);
      await migrationRunner("inspiration", migrations);
      await migrationRunner("inspiration", migrations);

      const captureA = new InspirationStore(scopedDatabaseUrl);
      const captureB = new InspirationStore(scopedDatabaseUrl);
      const flowA = new FlowStore(scopedDatabaseUrl);
      const flowB = new FlowStore(scopedDatabaseUrl);
      captureStores.push(captureA, captureB);
      flowStores.push(flowA, flowB);

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
      const initialSettings = await flowA.getSettings();
      const configured = await flowA.updateSettings({
        expectedVersion: initialSettings.version,
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
      });
      assert.equal(configured?.version, initialSettings.version + 1);

      const manualNow = new Date("2026-08-24T08:00:00.000Z");
      const reservations = await Promise.all([
        flowA.reserveNext("manual", "manual:postgres-race", manualNow),
        flowB.reserveNext("manual", "manual:postgres-race", manualNow),
      ]);
      assert.equal(reservations.filter((result) => result.shouldNotify).length, 1);
      assert.equal(
        new Set(reservations.map((result) => result.candidate?.delivery.id)).size,
        1
      );
      const owner = reservations.find((result) => result.shouldNotify);
      assert.ok(owner?.candidate);
      const sent = await flowA.finalizeNotification(
        owner.candidate.delivery.id,
        owner.candidate.delivery.version,
        { delivered: true, channel: "integration", at: manualNow }
      );
      assert.equal(sent.status, "sent");
      assert.equal(sent.attempts, 1);

      const statusBeforeLater = owner.candidate.inspiration.status;
      const later = await flowA.applyOutcome(
        sent.id,
        sent.version,
        owner.candidate.inspiration.version,
        "later",
        new Date(manualNow.getTime() + 120 * 60_000),
        manualNow
      );
      assert.equal(later.delivery.outcome, "later");
      assert.equal(later.inspiration.status, statusBeforeLater);
      assert.equal(
        later.inspiration.version,
        owner.candidate.inspiration.version,
        "later must not mutate inspiration lifecycle/version"
      );

      const oldScheduledAt = new Date("2026-08-24T10:00:00.000Z");
      const oldBucket = await flowA.reserveNext(
        "scheduled",
        "scheduled:60:old-bucket",
        oldScheduledAt
      );
      assert.equal(oldBucket.shouldNotify, true);
      assert.ok(oldBucket.candidate);
      assert.equal(oldBucket.candidate.delivery.status, "reserved");
      assert.equal(oldBucket.candidate.delivery.attempts, 1);

      const afterBoundary = new Date("2026-08-24T11:01:00.000Z");
      const recovered = await flowB.reserveNext(
        "scheduled",
        "scheduled:60:new-bucket",
        afterBoundary
      );
      assert.equal(recovered.shouldNotify, true);
      assert.ok(recovered.candidate);
      assert.equal(recovered.candidate.delivery.id, oldBucket.candidate.delivery.id);
      assert.equal(recovered.candidate.delivery.dedupeKey, "scheduled:60:old-bucket");
      assert.equal(recovered.candidate.delivery.attempts, 2);
      assert.deepEqual(recovered.explanation, ["recovery:pending-delivery"]);

      const finalizedRecovery = await flowB.finalizeNotification(
        recovered.candidate.delivery.id,
        recovered.candidate.delivery.version,
        { delivered: false, error: "notifications.send failed", at: afterBoundary }
      );
      assert.equal(finalizedRecovery.status, "failed");
      assert.equal(finalizedRecovery.attempts, 2);

      const retryAfterFailure = await flowA.reserveNext(
        "scheduled",
        "scheduled:60:retry-after-failure",
        new Date("2026-08-24T12:02:00.000Z")
      );
      assert.equal(retryAfterFailure.shouldNotify, true);
      assert.ok(retryAfterFailure.candidate);
      assert.notEqual(
        retryAfterFailure.candidate.delivery.id,
        finalizedRecovery.id,
        "a failed attempt must remain eligible for a later dedupe bucket"
      );

      let releaseSettingsLock!: () => void;
      let settingsLocked!: () => void;
      const lockAcquired = new Promise<void>((resolve) => {
        settingsLocked = resolve;
      });
      const releaseLock = new Promise<void>((resolve) => {
        releaseSettingsLock = resolve;
      });
      const heldLock = blocker.begin(async (transaction) => {
        await transaction`
          SELECT * FROM inspiration_flow_settings
          WHERE id = 'default'
          FOR UPDATE
        `;
        settingsLocked();
        await releaseLock;
      });
      await lockAcquired;

      const abortController = new AbortController();
      const abortedReservation = flowA.reserveNext(
        "scheduled",
        "scheduled:60:aborted-lock-wait",
        new Date("2026-08-24T12:30:00.000Z"),
        abortController.signal
      );
      const abortedAssertion = assert.rejects(
        abortedReservation,
        (error) => error instanceof Error && error.name === "AbortError"
      );
      abortController.abort();
      releaseSettingsLock();
      await heldLock;
      await abortedAssertion;
      const abortedRows = await blocker<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM inspiration_flow_deliveries
        WHERE dedupe_key = 'scheduled:60:aborted-lock-wait'
      `;
      assert.equal(abortedRows[0]?.count, 0);
    } finally {
      await Promise.all([
        ...captureStores.map((store) => store.close()),
        ...flowStores.map((store) => store.close()),
      ]);
      if (schemaCreated) {
        await admin.unsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
      }
      await blocker.end();
      await admin.end();
    }
  }
);
