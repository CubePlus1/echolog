import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import postgres from "postgres";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import { createPluginMigrationRunner } from "../src/core/plugins/migrations.js";
import { PluginHost } from "../src/core/plugins/host.js";
import { pluginRoutes } from "../src/server/routes/plugins.js";
import { ScreenStore } from "../plugins/screen-time/src/store.js";
import {
  DEFAULT_UNDERSTANDING_SETTINGS,
  UnderstandingSettingsService,
} from "../plugins/screen-time/src/understanding-settings.js";

const testDatabaseUrl = process.env.ECHOLOG_TEST_DATABASE_URL;

function testSchemaName(): string {
  return `el_test_ss_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function quoteTestSchema(schema: string): string {
  if (!/^el_test_ss_\d+_[a-f0-9]{12}$/.test(schema)) {
    throw new Error("refusing to use a non-test schema");
  }
  return `"${schema}"`;
}

function databaseUrlForSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

test("screen-time integration requires an explicit test database URL", () => {
  assert.ok(
    testDatabaseUrl,
    "set ECHOLOG_TEST_DATABASE_URL to run PostgreSQL integration tests"
  );
});

test(
  "screen understanding settings seed on first PUT, reload, race, and serve over HTTP",
  { skip: !testDatabaseUrl, timeout: 30_000 },
  async () => {
    if (!testDatabaseUrl) return;

    const schema = testSchemaName();
    const quotedSchema = quoteTestSchema(schema);
    const scopedDatabaseUrl = databaseUrlForSchema(testDatabaseUrl, schema);
    const admin = postgres(testDatabaseUrl, { max: 1 });
    let schemaCreated = false;
    let firstStore: ScreenStore | null = null;
    let secondStore: ScreenStore | null = null;
    let restartedStore: ScreenStore | null = null;
    let host: PluginHost | null = null;
    let app: ReturnType<typeof Fastify> | null = null;

    try {
      await admin.unsafe(`CREATE SCHEMA ${quotedSchema}`);
      schemaCreated = true;

      const migrationRunner = createPluginMigrationRunner(scopedDatabaseUrl);
      const migrations = screenTimePlugin.migrations ?? [];
      await migrationRunner("screen-time", migrations);
      await migrationRunner("screen-time", migrations);

      host = new PluginHost({
        definitions: [screenTimePlugin],
        logger,
        migrationRunner,
        commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        services: { "database.url": scopedDatabaseUrl },
      });
      await host.initialize();
      assert.equal(host.list()[0]?.state, "ready");

      app = Fastify({ logger: false });
      await pluginRoutes(app, host);
      const firstUpdateResponse = await app.inject({
        method: "PUT",
        url: "/api/plugins/screen-time/understanding/settings",
        headers: { "content-type": "application/json" },
        payload: {
          expectedVersion: 1,
          ...DEFAULT_UNDERSTANDING_SETTINGS,
          enabled: true,
        },
      });
      assert.equal(firstUpdateResponse.statusCode, 200);
      assert.equal(firstUpdateResponse.json().version, 2);

      firstStore = new ScreenStore(scopedDatabaseUrl);
      secondStore = new ScreenStore(scopedDatabaseUrl);
      const [firstDefault, secondDefault] = await Promise.all([
        firstStore.getUnderstandingSettings(),
        secondStore.getUnderstandingSettings(),
      ]);
      assert.equal(firstDefault.version, 2);
      assert.equal(firstDefault.enabled, true);
      assert.equal(secondDefault.version, 2);

      const firstService = new UnderstandingSettingsService(firstStore);
      const secondService = new UnderstandingSettingsService(secondStore);
      assert.equal((await secondService.get()).version, 2);
      const updated = await firstService.update(2, {
        ...DEFAULT_UNDERSTANDING_SETTINGS,
        enabled: true,
      });
      assert.equal(updated.ok, true);
      assert.equal((await secondService.get()).version, 3);

      const [left, right] = await Promise.all([
        firstService.update(3, {
          ...DEFAULT_UNDERSTANDING_SETTINGS,
          enabled: true,
          providerProfileId: "profile-left",
        }),
        secondService.update(3, {
          ...DEFAULT_UNDERSTANDING_SETTINGS,
          enabled: true,
          providerProfileId: "profile-right",
        }),
      ]);
      assert.equal([left, right].filter((result) => result.ok).length, 1);
      assert.equal([left, right].filter((result) => !result.ok).length, 1);

      restartedStore = new ScreenStore(scopedDatabaseUrl);
      assert.equal((await restartedStore.getUnderstandingSettings()).version, 4);

      const getResponse = await app.inject({
        method: "GET",
        url: "/api/plugins/screen-time/understanding/settings",
      });
      assert.equal(getResponse.statusCode, 200);
      assert.equal(getResponse.json().version, 4);

      const updateResponse = await app.inject({
        method: "PUT",
        url: "/api/plugins/screen-time/understanding/settings",
        headers: { "content-type": "application/json" },
        payload: {
          expectedVersion: 4,
          ...DEFAULT_UNDERSTANDING_SETTINGS,
          enabled: true,
          providerProfileId: "vision-primary",
          remoteConsentOrigin: "https://vision.example.com",
        },
      });
      assert.equal(updateResponse.statusCode, 200);
      assert.equal(updateResponse.json().version, 5);

      const invalidResponse = await app.inject({
        method: "PUT",
        url: "/api/plugins/screen-time/understanding/settings",
        headers: { "content-type": "application/json" },
        payload: {
          expectedVersion: 5,
          ...DEFAULT_UNDERSTANDING_SETTINGS,
          providerProfileId: "bad\u0000profile",
        },
      });
      assert.equal(invalidResponse.statusCode, 400);

      const conflictResponse = await app.inject({
        method: "PUT",
        url: "/api/plugins/screen-time/understanding/settings",
        headers: { "content-type": "application/json" },
        payload: { expectedVersion: 4, ...DEFAULT_UNDERSTANDING_SETTINGS },
      });
      assert.equal(conflictResponse.statusCode, 409);
      assert.equal(conflictResponse.json().currentVersion, 5);
    } finally {
      await app?.close();
      await host?.stop();
      await restartedStore?.close();
      await secondStore?.close();
      await firstStore?.close();
      if (schemaCreated) await admin.unsafe(`DROP SCHEMA ${quotedSchema} CASCADE`);
      await admin.end();
    }
  }
);
