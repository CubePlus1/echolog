import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import type { AppRule } from "../plugins/screen-time/src/schema.js";
import { classifySegment } from "../plugins/screen-time/src/screen.js";
import { createScreenRoutes } from "../plugins/screen-time/src/routes.js";
import {
  DEFAULT_UNDERSTANDING_SETTINGS,
  UnderstandingSettingsService,
  validateUnderstandingSettingsUpdate,
} from "../plugins/screen-time/src/understanding-settings.js";
import { PluginHost } from "../src/core/plugins/host.js";
import { pluginRoutes } from "../src/server/routes/plugins.js";

function rule(overrides: Partial<AppRule> = {}): AppRule {
  return {
    id: "rule-1",
    appMatch: "wechat",
    label: "生活",
    startMinute: null,
    endMinute: null,
    weekdays: null,
    priority: 0,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

test("screen classification preserves priority and time-window behavior", () => {
  const slices = classifySegment(
    [
      rule(),
      rule({
        id: "work-hours",
        label: "工作",
        startMinute: 9 * 60,
        endMinute: 10 * 60,
        priority: 10,
      }),
    ],
    {
      bundleId: "com.tencent.wechat",
      appName: "WeChat",
      startAt: new Date(2026, 6, 31, 8, 30),
      endAt: new Date(2026, 6, 31, 10, 30),
    }
  );

  assert.deepEqual(
    slices.map(({ label, seconds }) => ({ label, seconds })),
    [
      { label: "生活", seconds: 1_800 },
      { label: "工作", seconds: 3_600 },
      { label: "生活", seconds: 1_800 },
    ]
  );
});

test("compatibility routes remain registered and validate input", async () => {
  const service = {
    async getDaily(date: string) {
      return { date };
    },
    async listRules() {
      return [];
    },
    async createRule(input: unknown) {
      return input;
    },
    async deleteRule() {
      return null;
    },
  };
  const routes = createScreenRoutes(() => service as never);
  const compatibility = routes.filter((route) => route.compatibilityAlias);
  assert.equal(compatibility.length, 5);

  const daily = compatibility.find(
    (route) => route.path === "/api/screen/daily/:date"
  );
  const result = await daily!.handler(
    {
      params: { date: "not-a-date" },
      query: {},
      body: undefined,
      headers: {},
    },
    new AbortController().signal
  );
  assert.deepEqual(result, {
    statusCode: 400,
    body: { error: "date must be YYYY-MM-DD" },
  });
});

test("disabled screen-time compatibility endpoints return structured 503", async () => {
  const app = Fastify({ logger: false });
  const host = new PluginHost({
    definitions: [screenTimePlugin],
    configuration: { "screen-time": { enabled: false } },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });
  await host.initialize();
  app.setErrorHandler((error, _request, reply) => {
    const pluginError = error as {
      statusCode?: number;
      message: string;
      code?: string;
      pluginId?: string;
      state?: string;
    };
    return reply.code(pluginError.statusCode ?? 500).send({
      error: pluginError.message,
      code: pluginError.code,
      pluginId: pluginError.pluginId,
      state: pluginError.state,
    });
  });
  await pluginRoutes(app, host);

  const response = await app.inject({
    method: "GET",
    url: "/api/screen/today",
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: "Plugin screen-time is disabled",
    code: "PLUGIN_DISABLED",
    pluginId: "screen-time",
    state: "disabled",
  });
  await app.close();
});

test("screen understanding settings validation is strict and normalizes origins", () => {
  const valid = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    providerProfileId: " profile-1 ",
    remoteConsentOrigin: "https://vision.example.com",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.providerProfileId, "profile-1");
    assert.equal(valid.value.remoteConsentOrigin, "https://vision.example.com");
  }

  const unknown = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    apiKey: "must-not-be-accepted",
  });
  assert.deepEqual(unknown, {
    ok: false,
    error: "unknown settings field: apiKey",
  });

  const unsafeOrigin = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    remoteConsentOrigin: "https://vision.example.com/path",
  });
  assert.equal(unsafeOrigin.ok, false);

  for (const remoteConsentOrigin of [
    "http://localhost:11434",
    "http://127.0.0.1:11434",
    "http://[::1]:11434",
  ]) {
    const loopbackOrigin = validateUnderstandingSettingsUpdate({
      expectedVersion: 1,
      ...DEFAULT_UNDERSTANDING_SETTINGS,
      remoteConsentOrigin,
    });
    assert.equal(loopbackOrigin.ok, true);
  }

  const insecureRemoteOrigin = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    remoteConsentOrigin: "http://vision.example.com",
  });
  assert.equal(insecureRemoteOrigin.ok, false);

  const credentialedOrigin = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    remoteConsentOrigin: "https://user:password@vision.example.com",
  });
  assert.equal(credentialedOrigin.ok, false);

  const invalidProfileId = validateUnderstandingSettingsUpdate({
    expectedVersion: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    providerProfileId: "profile\u0000id",
  });
  assert.equal(invalidProfileId.ok, false);
});

test("understanding settings service updates settings and reports version conflicts", async () => {
  let row = {
    id: "default",
    version: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: new Date("2026-08-06T00:00:00Z"),
  };
  const service = new UnderstandingSettingsService({
    async getUnderstandingSettings() {
      return row;
    },
    async updateUnderstandingSettings(expectedVersion, input) {
      if (expectedVersion !== row.version) return null;
      row = { ...row, ...input, version: row.version + 1, updatedAt: new Date() };
      return row;
    },
  });

  const updated = await service.update(1, {
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    enabled: true,
  });
  assert.equal(updated.ok, true);
  assert.equal((await service.get()).version, 2);
  assert.equal((await service.get()).enabled, true);

  const conflict = await service.update(1, DEFAULT_UNDERSTANDING_SETTINGS);
  assert.deepEqual(conflict, { ok: false, currentVersion: 2 });
});

test("understanding settings service reloads settings written by another service", async () => {
  let row = {
    id: "default",
    version: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: new Date("2026-08-06T00:00:00Z"),
  };
  const store = {
    async getUnderstandingSettings() {
      return row;
    },
    async updateUnderstandingSettings(expectedVersion: number, input: typeof DEFAULT_UNDERSTANDING_SETTINGS) {
      if (expectedVersion !== row.version) return null;
      row = { ...row, ...input, version: row.version + 1, updatedAt: new Date() };
      return row;
    },
  };
  const first = new UnderstandingSettingsService(store);
  const second = new UnderstandingSettingsService(store);

  assert.equal((await second.get()).version, 1);
  const updated = await first.update(1, {
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    enabled: true,
  });
  assert.equal(updated.ok, true);
  assert.equal((await second.get()).version, 2);
  assert.equal((await second.get()).enabled, true);
});

test("screen understanding migration remains additive and constrained", () => {
  assert.deepEqual(
    screenTimePlugin.migrations?.map((migration) => migration.name),
    ["001_existing_screen_tables_baseline", "002_screen_understanding_settings"]
  );
  const migration = screenTimePlugin.migrations?.[1]?.sql ?? "";
  assert.match(migration, /CREATE TABLE IF NOT EXISTS screen_understanding_settings/);
  assert.match(migration, /CHECK \(id = 'default'\)/);
  assert.match(migration, /CHECK \(capture_display = 'active'\)/);
});

test("understanding settings routes are canonical-only and preserve conflict metadata", async () => {
  const screenService = {
    async getDaily() { return {}; },
    async listRules() { return []; },
    async createRule() { return {}; },
    async deleteRule() { return null; },
  };
  const settingsService = {
    async get() {
      return {
        id: "default",
        version: 2,
        ...DEFAULT_UNDERSTANDING_SETTINGS,
        updatedAt: new Date("2026-08-06T00:00:00Z"),
      };
    },
    async update(expectedVersion: number, input: typeof DEFAULT_UNDERSTANDING_SETTINGS) {
      return expectedVersion === 2
        ? {
            ok: true as const,
            settings: {
              id: "default",
              version: 3,
              ...input,
              updatedAt: new Date("2026-08-06T00:00:00Z"),
            },
          }
        : { ok: false as const, currentVersion: 2 };
    },
  };
  const routes = createScreenRoutes(
    () => screenService as never,
    () => settingsService as never
  );
  const canonical = routes.find(
    (route) => route.path === "/api/plugins/screen-time/understanding/settings" &&
      route.method === "PUT"
  );
  const getCanonical = routes.find(
    (route) => route.path === "/api/plugins/screen-time/understanding/settings" &&
      route.method === "GET"
  );
  assert.ok(canonical);
  assert.ok(getCanonical);
  assert.equal(
    routes.some((route) => route.path === "/api/screen/understanding/settings"),
    false
  );
  const current = await getCanonical.handler(
    {
      params: {},
      query: {},
      body: undefined,
      headers: {},
    },
    new AbortController().signal
  );
  assert.equal(current.version, 2);
  const success = await canonical.handler(
    {
      params: {},
      query: {},
      body: { expectedVersion: 2, ...DEFAULT_UNDERSTANDING_SETTINGS },
      headers: {},
    },
    new AbortController().signal
  );
  assert.equal(success.version, 3);
  const invalid = await canonical.handler(
    {
      params: {},
      query: {},
      body: {
        expectedVersion: 2,
        ...DEFAULT_UNDERSTANDING_SETTINGS,
        remoteConsentOrigin: "http://vision.example.com",
      },
      headers: {},
    },
    new AbortController().signal
  );
  assert.deepEqual(invalid, {
    statusCode: 400,
    body: {
      error: "remoteConsentOrigin must be null, an HTTPS origin, or an HTTP loopback origin without credentials, path, query, or fragment",
    },
  });
  const conflict = await canonical.handler(
    {
      params: {},
      query: {},
      body: { expectedVersion: 1, ...DEFAULT_UNDERSTANDING_SETTINGS },
      headers: {},
    },
    new AbortController().signal
  );
  assert.deepEqual(conflict, {
    statusCode: 409,
    body: {
      error: "screen understanding settings version conflict",
      currentVersion: 2,
    },
  });
});
