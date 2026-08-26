import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import type { AppRule } from "../plugins/screen-time/src/schema.js";
import { classifySegment } from "../plugins/screen-time/src/screen.js";
import { createScreenRoutes } from "../plugins/screen-time/src/routes.js";
import {
  INTERACTIVE_KEYCHAIN_TIMEOUT_MS,
  MacKeychainClient,
  NON_INTERACTIVE_KEYCHAIN_TIMEOUT_MS,
} from "../plugins/screen-time/src/macos-keychain-client.js";
import {
  DEFAULT_MACOS_HELPER_EXECUTABLE,
  MACOS_HELPER_BUILD_COMMAND,
} from "../plugins/screen-time/src/macos-helper.js";
import {
  ProviderError,
  ProviderProfileService,
  validateProviderCreate,
  validateProviderKey,
  validateProviderUpdate,
} from "../plugins/screen-time/src/provider-profiles.js";
import {
  DEFAULT_UNDERSTANDING_SETTINGS,
  UnderstandingSettingsService,
  validateUnderstandingSettingsUpdate,
} from "../plugins/screen-time/src/understanding-settings.js";
import { PluginHost } from "../src/core/plugins/host.js";
import { runPluginCommand } from "../src/core/plugins/command-runner.js";
import { pluginRoutes } from "../src/server/routes/plugins.js";
import { SCREEN_UNDERSTANDING_SCHEDULER_POLL_MS } from "../plugins/screen-time/src/index.js";

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

test("screen understanding scheduler polls more finely than its configured interval", () => {
  assert.equal(SCREEN_UNDERSTANDING_SCHEDULER_POLL_MS, 5_000);
  assert.ok(SCREEN_UNDERSTANDING_SCHEDULER_POLL_MS < 60_000);
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

test("stale settings updates do not consult provider secrets", async () => {
  const row = {
    id: "default",
    version: 2,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: new Date(),
  };
  let guardCalls = 0;
  const service = new UnderstandingSettingsService({
    async getUnderstandingSettings() { return row; },
    async updateUnderstandingSettings() { throw new Error("must not update"); },
  }, {
    async withSelectable() {
      guardCalls++;
      throw new Error("must not inspect provider");
    },
  });
  assert.deepEqual(await service.update(1, {
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    enabled: true,
    providerProfileId: "vision-primary",
  }), { ok: false, currentVersion: 2 });
  assert.equal(guardCalls, 0);
});

test("screen understanding migration remains additive and constrained", () => {
  assert.deepEqual(
    screenTimePlugin.migrations?.map((migration) => migration.name),
    [
      "001_existing_screen_tables_baseline",
      "002_screen_understanding_settings",
      "003_screen_understanding_provider_profiles",
      "004_screen_understanding_runtime",
    ]
  );
  const migration = screenTimePlugin.migrations?.[1]?.sql ?? "";
  assert.match(migration, /CREATE TABLE IF NOT EXISTS screen_understanding_settings/);
  assert.match(migration, /CHECK \(id = 'default'\)/);
  assert.match(migration, /CHECK \(capture_display = 'active'\)/);
  const providers = screenTimePlugin.migrations?.[2]?.sql ?? "";
  assert.match(providers, /CREATE TABLE IF NOT EXISTS screen_understanding_provider_profiles/);
  assert.match(providers, /CHECK \(version >= 1\)/);
  assert.match(providers, /CHECK \(provider_kind = 'openai-compatible'\)/);
  const runtime = screenTimePlugin.migrations?.[3]?.sql ?? "";
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS screen_understanding_requests/);
  assert.match(runtime, /CREATE TABLE IF NOT EXISTS screen_understanding_observations/);
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

test("provider validators are strict and normalize safe base URLs", () => {
  const valid = validateProviderCreate({
    id: " vision-primary ",
    displayName: " Primary vision ",
    providerKind: "openai-compatible",
    baseUrl: "https://vision.example.com/v1/",
    model: " vision-model ",
  });
  assert.deepEqual(valid, {
    ok: true,
    value: {
      id: "vision-primary",
      displayName: "Primary vision",
      providerKind: "openai-compatible",
      baseUrl: "https://vision.example.com/v1",
      model: "vision-model",
    },
  });
  assert.equal(validateProviderCreate({ ...valid.ok && valid.value, extra: true }).ok, false);
  assert.equal(validateProviderCreate({
    id: "remote",
    displayName: "Remote",
    providerKind: "openai-compatible",
    baseUrl: "http://vision.example.com/v1",
    model: "model",
  }).ok, false);
  assert.equal(validateProviderCreate({
    id: "loopback",
    displayName: "Loopback",
    providerKind: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "model",
  }).ok, true);
  assert.equal(validateProviderUpdate({
    expectedVersion: 0,
    displayName: "Name",
    providerKind: "openai-compatible",
    baseUrl: "https://vision.example.com/v1",
    model: "model",
  }).ok, false);
  assert.equal(validateProviderKey({ apiKey: " test-value" }).ok, false);
  assert.equal(validateProviderKey({ apiKey: "test\nvalue" }).ok, false);
  assert.equal(validateProviderKey({ apiKey: "x".repeat(4097) }).ok, false);
  assert.equal(validateProviderKey({ apiKey: "test-value" }).ok, true);
});

test("macOS Keychain client follows the bounded helper and cache contract", async () => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "echolog-keychain-fake-"));
  const fakeExecutable = join(
    fakeRoot,
    "EchoLogScreenCapture.app",
    "Contents",
    "MacOS",
    "echolog-screen-capture"
  );
  await mkdir(join(fakeRoot, "EchoLogScreenCapture.app", "Contents", "MacOS"), {
    recursive: true,
  });
  await writeFile(fakeExecutable, "#!/bin/sh\nexit 0\n");
  await chmod(fakeExecutable, 0o755);
  const requests: Array<{ args: string[]; stdin?: string; timeoutMs?: number }> = [];
  try {
    const client = new MacKeychainClient(async (request) => {
      requests.push({
        args: request.args,
        stdin: request.stdin,
        timeoutMs: request.timeoutMs,
      });
      const operation = request.args[1];
      return {
        stdout: JSON.stringify(operation === "get"
          ? { ok: true, hasSecret: true, secret: "cached-credential-value" }
          : { ok: true, hasSecret: operation !== "delete" }),
        stderr: "",
        exitCode: 0,
      };
    }, fakeExecutable);
    assert.equal(await client.has("vision-primary"), true);
    assert.deepEqual(requests[0]?.args, [
      "keychain",
      "status",
      "--service",
      "com.cubeplus1.echolog.screen-understanding",
      "--account",
      "vision-primary",
      "--no-auth-ui",
      "--json",
    ]);
    assert.equal(requests[0]?.timeoutMs, NON_INTERACTIVE_KEYCHAIN_TIMEOUT_MS);
    assert.equal(requests[0]?.stdin, undefined);

    assert.equal(
      await client.get("manual-profile", undefined, "interactive"),
      "cached-credential-value"
    );
    assert.equal(requests[1]?.args.includes("--no-auth-ui"), false);
    assert.equal(requests[1]?.timeoutMs, INTERACTIVE_KEYCHAIN_TIMEOUT_MS);
    assert.equal(
      await client.get("manual-profile", undefined, "non-interactive"),
      "cached-credential-value"
    );
    assert.equal(requests.length, 2);

    await client.set("vision-primary", "test-credential-value");
    assert.deepEqual(JSON.parse(requests[2]?.stdin ?? ""), {
      secret: "test-credential-value",
    });
    assert.equal(requests[2]?.args.join(" ").includes("test-credential-value"), false);
    assert.equal(requests[2]?.timeoutMs, INTERACTIVE_KEYCHAIN_TIMEOUT_MS);
    assert.equal(await client.get("vision-primary", undefined, "non-interactive"), "test-credential-value");
    assert.equal(requests.length, 3);
    assert.equal(client.cachedState("vision-primary"), true);
    assert.equal(client.hasCachedValue("vision-primary"), true);

    await client.delete("vision-primary");
    assert.equal(requests[3]?.timeoutMs, INTERACTIVE_KEYCHAIN_TIMEOUT_MS);
    assert.equal(client.cachedState("vision-primary"), false);
    assert.equal(client.hasCachedValue("vision-primary"), false);
    assert.equal(await client.get("vision-primary", undefined, "non-interactive"), null);
    assert.equal(requests.length, 4);

    client.clearCache();
    assert.equal(client.cachedState("manual-profile"), null);
    assert.equal(client.hasCachedValue("manual-profile"), false);

    const failed = new MacKeychainClient(async () => {
      const error = new Error("spawn failed") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    }, fakeExecutable);
    await assert.rejects(
      failed.has("vision-primary"),
      (error) => error instanceof ProviderError &&
        error.code === "KEYCHAIN_UNAVAILABLE" &&
        error.message.includes("could not be launched") &&
        !error.message.includes("test-credential-value")
    );

    const timedOut = new MacKeychainClient(async () => {
      throw Object.assign(new Error("command timed out"), {
        code: null,
        killed: true,
        signal: "SIGTERM",
      });
    }, fakeExecutable);
    await assert.rejects(
      timedOut.has("vision-primary"),
      (error) => error instanceof ProviderError &&
        error.code === "PLUGIN_TIMEOUT" &&
        error.statusCode === 504 &&
        error.message === "Keychain helper timed out"
    );

    const authRequired = new MacKeychainClient(async () => ({
      stdout: JSON.stringify({
        ok: false,
        error: "private helper detail",
        code: "KEYCHAIN_AUTH_REQUIRED",
        retryable: false,
      }),
      stderr: "test-credential-value must not escape",
      exitCode: 10,
    }), fakeExecutable);
    await assert.rejects(
      authRequired.get("vision-primary", undefined, "non-interactive"),
      (error) => error instanceof ProviderError &&
        error.code === "KEYCHAIN_AUTH_REQUIRED" &&
        error.statusCode === 409 &&
        !error.message.includes("test-credential-value") &&
        !error.message.includes("private helper detail")
    );
  } finally {
    await rm(fakeRoot, { recursive: true, force: true });
  }

  const missingRoot = await mkdtemp(join(tmpdir(), "echolog-keychain-helper-"));
  try {
    const missingExecutable = join(
      missingRoot,
      "EchoLogScreenCapture.app",
      "Contents",
      "MacOS",
      "echolog-screen-capture"
    );
    const missing = new MacKeychainClient(async () => {
      throw new Error("must not spawn a missing helper");
    }, missingExecutable);
    await assert.rejects(
      missing.has("vision-primary"),
      (error) => error instanceof ProviderError &&
        error.code === "KEYCHAIN_UNAVAILABLE" &&
        error.statusCode === 503 &&
        error.message.includes("EchoLogScreenCapture.app is missing") &&
        error.message.includes(MACOS_HELPER_BUILD_COMMAND)
    );
  } finally {
    await rm(missingRoot, { recursive: true, force: true });
  }
});

test("macOS Keychain client matches the real Swift helper contract", {
  skip: process.platform !== "darwin" || !existsSync(DEFAULT_MACOS_HELPER_EXECUTABLE),
}, async () => {
  const client = new MacKeychainClient(runPluginCommand, DEFAULT_MACOS_HELPER_EXECUTABLE);
  assert.equal(await client.has("echolog-contract-test-missing"), false);
});

test("provider metadata remains readable and editable when Keychain status is unavailable", async () => {
  const now = new Date();
  let row = {
    id: "vision-primary",
    version: 1,
    displayName: "Primary",
    providerKind: "openai-compatible" as const,
    baseUrl: "https://vision.example.com/v1",
    model: "model",
    createdAt: now,
    updatedAt: now,
  };
  const store = {
    async countProviderProfiles() { return 1; },
    async listProviderProfiles() { return [row]; },
    async getProviderProfile() { return row; },
    async createProviderProfile() { return null; },
    async updateProviderProfile(_id: string, expectedVersion: number, input: any) {
      if (expectedVersion !== row.version) return null;
      row = { ...row, ...input, version: row.version + 1, updatedAt: new Date() };
      return row;
    },
    async deleteProviderProfile() { return null; },
    async getUnderstandingSettings() {
      return { id: "default", version: 1, ...DEFAULT_UNDERSTANDING_SETTINGS, updatedAt: now };
    },
  };
  let helperQueries = 0;
  const unavailable = async () => {
    helperQueries++;
    throw new ProviderError("KEYCHAIN_UNAVAILABLE", "Keychain helper is unavailable", 503);
  };
  const service = new ProviderProfileService(store, {
    has: unavailable,
    set: unavailable,
    delete: unavailable,
    cachedState() { return null; },
  });
  assert.equal((await service.list())[0]?.hasApiKey, null);
  const updated = await service.update("vision-primary", 1, {
    displayName: "Updated",
    providerKind: "openai-compatible",
    baseUrl: "https://vision.example.com/v1",
    model: "model-2",
  });
  assert.equal(updated.displayName, "Updated");
  assert.equal(updated.hasApiKey, null);
  assert.equal(helperQueries, 0);
});

test("provider service enforces CAS, references, and write-only key state", async () => {
  const rows = new Map<string, any>();
  let settings = {
    id: "default",
    version: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: new Date(),
  };
  const keys = new Set<string>();
  const store = {
    async countProviderProfiles() { return rows.size; },
    async listProviderProfiles() { return [...rows.values()]; },
    async getProviderProfile(id: string) { return rows.get(id) ?? null; },
    async createProviderProfile(input: any) {
      if (rows.has(input.id)) return null;
      const now = new Date();
      const row = { ...input, version: 1, createdAt: now, updatedAt: now };
      rows.set(input.id, row);
      return row;
    },
    async updateProviderProfile(id: string, expectedVersion: number, input: any) {
      const row = rows.get(id);
      if (!row || row.version !== expectedVersion) return null;
      const updated = { ...row, ...input, version: row.version + 1, updatedAt: new Date() };
      rows.set(id, updated);
      return updated;
    },
    async deleteProviderProfile(id: string, expectedVersion: number) {
      const row = rows.get(id);
      if (!row || row.version !== expectedVersion) return null;
      rows.delete(id);
      return row;
    },
    async getUnderstandingSettings() { return settings; },
    async updateUnderstandingSettings(expectedVersion: number, input: any) {
      if (settings.version !== expectedVersion) return null;
      settings = {
        ...settings,
        ...input,
        version: settings.version + 1,
        updatedAt: new Date(),
      };
      return settings;
    },
  };
  const secrets = {
    async has(id: string) { return keys.has(id); },
    async set(id: string) { keys.add(id); },
    async delete(id: string) { keys.delete(id); },
    cachedState(id: string) { return keys.has(id); },
    hasCachedValue(id: string) { return keys.has(id); },
  };
  const service = new ProviderProfileService(store, secrets);
  const created = await service.create({
    id: "vision-primary",
    displayName: "Primary",
    providerKind: "openai-compatible",
    baseUrl: "https://vision.example.com/v1",
    model: "model",
  });
  assert.equal(created.hasApiKey, false);
  assert.equal(JSON.stringify(created).includes("secret"), false);
  assert.equal(JSON.stringify(created).includes("apiKey"), false);
  await service.setKey("vision-primary", "test-credential-value");
  assert.equal((await service.list())[0]?.hasApiKey, true);
  await assert.rejects(
    service.update("vision-primary", 99, {
      displayName: "Updated",
      providerKind: "openai-compatible",
      baseUrl: "https://vision.example.com/v1",
      model: "model",
    }),
    (error) => error instanceof ProviderError &&
      error.code === "PROVIDER_PROFILE_CONFLICT" &&
      error.currentVersion === 1
  );
  await assert.rejects(
    service.deleteProfile("vision-primary", 99),
    (error) => error instanceof ProviderError &&
      error.code === "PROVIDER_PROFILE_CONFLICT" &&
      error.currentVersion === 1
  );
  assert.equal(keys.has("vision-primary"), true);
  settings = { ...settings, enabled: true, providerProfileId: "vision-primary" };
  await assert.rejects(
    service.deleteKey("vision-primary"),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_PROFILE_IN_USE"
  );
  await assert.rejects(
    service.deleteProfile("vision-primary", 1),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_PROFILE_IN_USE"
  );

  keys.delete("vision-primary");
  const guardedSettings = new UnderstandingSettingsService(store, service);
  await assert.rejects(
    guardedSettings.update(1, {
      ...DEFAULT_UNDERSTANDING_SETTINGS,
      enabled: true,
      providerProfileId: "vision-primary",
    }),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_KEY_REQUIRED"
  );
  await assert.rejects(
    guardedSettings.update(1, {
      ...DEFAULT_UNDERSTANDING_SETTINGS,
      enabled: true,
      providerProfileId: null,
    }),
    (error) => error instanceof ProviderError && error.code === "PROVIDER_KEY_REQUIRED"
  );
});

test("settings selection and provider deletion share the profile lock", async () => {
  const now = new Date();
  const row = {
    id: "vision-primary",
    version: 1,
    displayName: "Primary",
    providerKind: "openai-compatible" as const,
    baseUrl: "https://vision.example.com/v1",
    model: "model",
    createdAt: now,
    updatedAt: now,
  };
  let settings = {
    id: "default",
    version: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: now,
  };
  let enterUpdate!: () => void;
  let releaseUpdate!: () => void;
  const updateEntered = new Promise<void>((resolve) => { enterUpdate = resolve; });
  const updateRelease = new Promise<void>((resolve) => { releaseUpdate = resolve; });
  let deletedSecret = false;
  const store = {
    async countProviderProfiles() { return 1; },
    async listProviderProfiles() { return [row]; },
    async getProviderProfile(id: string) { return id === row.id ? row : null; },
    async createProviderProfile() { return null; },
    async updateProviderProfile() { return null; },
    async deleteProviderProfile() { return row; },
    async getUnderstandingSettings() { return settings; },
    async updateUnderstandingSettings(expectedVersion: number, input: any) {
      enterUpdate();
      await updateRelease;
      if (settings.version !== expectedVersion) return null;
      settings = { ...settings, ...input, version: 2, updatedAt: new Date() };
      return settings;
    },
  };
  const profiles = new ProviderProfileService(store, {
    async has() { return true; },
    async set() {},
    async delete() { deletedSecret = true; },
  });
  const guardedSettings = new UnderstandingSettingsService(store, profiles);
  const selection = guardedSettings.update(1, {
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    enabled: true,
    providerProfileId: row.id,
  });
  await updateEntered;
  const deletion = profiles.deleteProfile(row.id, 1);
  releaseUpdate();
  assert.equal((await selection).ok, true);
  await assert.rejects(
    deletion,
    (error) => error instanceof ProviderError && error.code === "PROVIDER_PROFILE_IN_USE"
  );
  assert.equal(deletedSecret, false);
});

test("provider routes are canonical and key mutations are local-only", () => {
  const routes = createScreenRoutes(
    () => ({}) as never,
    () => ({}) as never,
    () => ({}) as never
  );
  const providerRoutes = routes.filter((route) =>
    route.path.startsWith("/api/plugins/screen-time/understanding/providers")
  );
  assert.equal(providerRoutes.length, 6);
  assert.equal(providerRoutes.some((route) => route.compatibilityAlias), false);
  assert.deepEqual(
    providerRoutes.filter((route) => route.localOnly).map((route) => route.method).sort(),
    ["DELETE", "PUT"]
  );
});

test("provider routes return structured validation and redacted helper errors", async () => {
  const credential = "route-test-credential";
  const routes = createScreenRoutes(
    () => ({}) as never,
    () => ({}) as never,
    () => ({
      async setKey() {
        throw new ProviderError(
          "KEYCHAIN_OPERATION_FAILED",
          "Keychain operation failed",
          502
        );
      },
    }) as never
  );
  const keyRoute = routes.find((route) =>
    route.method === "PUT" && route.path.endsWith("/providers/:id/key")
  );
  assert.ok(keyRoute);

  const invalid = await keyRoute.handler({
    params: { id: "vision-primary" },
    query: {},
    body: { apiKey: credential, unexpected: true },
    headers: {},
  }, new AbortController().signal);
  assert.deepEqual(invalid, {
    statusCode: 400,
    body: { error: "unknown provider field: unexpected" },
  });

  const failed = await keyRoute.handler({
    params: { id: "vision-primary" },
    query: {},
    body: { apiKey: credential },
    headers: {},
  }, new AbortController().signal);
  assert.deepEqual(failed, {
    statusCode: 502,
    body: {
      error: "Keychain operation failed",
      code: "KEYCHAIN_OPERATION_FAILED",
    },
  });
  assert.equal(JSON.stringify(failed).includes(credential), false);
});

test("screen-time Web clears submitted keys and never renders them", async () => {
  const modulePath = new URL("../plugins/screen-time/web/index.js", import.meta.url).href;
  const { activate } = await import(modulePath);
  const calls: Array<{ path: string; options?: { body?: string } }> = [];
  const provider = {
    id: "vision-primary",
    version: 1,
    displayName: "Primary",
    providerKind: "openai-compatible",
    baseUrl: "https://vision.example.com/v1",
    model: "model",
    hasApiKey: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const settings = {
    id: "default",
    version: 1,
    ...DEFAULT_UNDERSTANDING_SETTINGS,
    updatedAt: new Date().toISOString(),
  };
  let rejectKey = false;
  const contribution = await activate({
    api: async (path: string, options?: { body?: string }) => {
      calls.push({ path, options });
      if (path.endsWith("/today")) return { totalSeconds: 0, byLabel: [], apps: [] };
      if (path.endsWith("/rules")) return [];
      if (path.endsWith("/settings")) return settings;
      if (path.endsWith("/providers")) return { providers: [provider] };
      if (rejectKey) throw new Error(`reflected request: ${options?.body}`);
      return { id: provider.id, hasApiKey: true };
    },
  });
  const data = await contribution.load();
  const elements: Record<string, { value: string; textContent: string }> = {
    "spKey:vision-primary": { value: "test-credential-value", textContent: "" },
    "spError:vision-primary": { value: "", textContent: "" },
  };
  const result = await contribution.handleAction("set-provider-key", {
    id: "vision-primary",
    $: (id: string) => elements[id] ?? null,
    confirm: () => true,
  });
  assert.equal(result.handled, true);
  assert.equal(elements["spKey:vision-primary"].value, "");
  const keyCall = calls.at(-1);
  assert.deepEqual(JSON.parse(keyCall?.options?.body ?? ""), {
    apiKey: "test-credential-value",
  });
  const html = contribution.renderFace(
    { type: "understanding-providers" },
    {
      data,
      esc: (value: unknown) => String(value),
      escA: (value: unknown) => String(value),
      fmtDur: String,
    }
  );
  assert.equal(html.includes("test-credential-value"), false);
  assert.equal(JSON.stringify(data).includes("test-credential-value"), false);

  provider.hasApiKey = null;
  const unknownKeyHtml = contribution.renderFace(
    { type: "understanding-providers" },
    {
      data,
      esc: (value: unknown) => String(value),
      escA: (value: unknown) => String(value),
      fmtDur: String,
    }
  );
  assert.match(unknownKeyHtml, /密钥状态不可用/);
  assert.match(unknownKeyHtml, /保存或替换密钥/);
  assert.match(unknownKeyHtml, /删除密钥/);

  const standalone = await readFile(
    join(process.cwd(), "web/screen-understanding.js"),
    "utf8"
  );
  assert.match(standalone, /hasApiKey === null \? "密钥状态不可用"/);
  assert.match(standalone, /\$\("deleteKey"\)\.hidden = provider\.hasApiKey === false/);
  assert.match(
    await readFile(join(process.cwd(), "web/screen-understanding.html"), "utf8"),
    /id="deleteKey"/
  );

  provider.displayName = '<img src=x onerror="alert(1)">';
  provider.model = "<script>alert(2)</script>";
  const escapeText = (value: unknown) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const escapeAttribute = (value: unknown) => escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const escapedHtml = contribution.renderFace(
    { type: "understanding-providers" },
    { data, esc: escapeText, escA: escapeAttribute, fmtDur: String }
  );
  assert.equal(escapedHtml.includes('<img src=x onerror="alert(1)">'), false);
  assert.equal(escapedHtml.includes("<script>alert(2)</script>"), false);
  assert.match(escapedHtml, /&lt;img src=x onerror="alert\(1\)"&gt;/);
  assert.match(escapedHtml, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);

  rejectKey = true;
  elements["spKey:vision-primary"].value = "second-test-credential";
  await contribution.handleAction("set-provider-key", {
    id: "vision-primary",
    $: (id: string) => elements[id] ?? null,
    confirm: () => true,
  });
  assert.equal(elements["spKey:vision-primary"].value, "");
  assert.equal(elements["spError:vision-primary"].textContent.includes("second-test-credential"), false);
  assert.equal(
    elements["spError:vision-primary"].textContent,
    "密钥保存失败，请检查本机 Keychain helper 状态"
  );
});
