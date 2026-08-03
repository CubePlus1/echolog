import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  PLUGIN_API_VERSION,
  PluginError,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
} from "@echolog/plugin-sdk";
import { PluginHost } from "../src/core/plugins/host.js";
import { pluginRoutes } from "../src/server/routes/plugins.js";

const logger: PluginLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function manifest(id: string): PluginManifest {
  return {
    manifestVersion: 1,
    id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    displayName: id,
    description: `${id} test plugin`,
    entries: { server: "./dist/server.js" },
    capabilities: [],
    permissions: [],
    requires: { coreApi: "^1.0.0" },
  };
}

function host(
  definitions: PluginDefinition[],
  configuration: Record<string, { enabled?: boolean }> = {}
) {
  return new PluginHost({
    definitions,
    configuration,
    logger,
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });
}

test("initializes enabled plugins and stops them in reverse order", async () => {
  const events: string[] = [];
  const definitions = ["first", "second"].map<PluginDefinition>((id) => ({
    manifest: manifest(id),
    defaultEnabled: true,
    register(context) {
      events.push(`register:${id}`);
      context.registerRoute({
        method: "GET",
        path: `/api/plugins/${id}/status`,
        async handler() {
          return { id };
        },
      });
    },
    start() {
      events.push(`start:${id}`);
    },
    stop() {
      events.push(`stop:${id}`);
    },
  }));
  const pluginHost = host(definitions);

  await pluginHost.initialize();
  assert.deepEqual(
    pluginHost.list().map(({ id, state }) => ({ id, state })),
    [
      { id: "first", state: "ready" },
      { id: "second", state: "ready" },
    ]
  );
  assert.equal(pluginHost.routes().length, 2);

  await pluginHost.stop();
  assert.deepEqual(events, [
    "register:first",
    "start:first",
    "register:second",
    "start:second",
    "stop:second",
    "stop:first",
  ]);
});

test("does not migrate or start a disabled plugin", async () => {
  let migrations = 0;
  let starts = 0;
  const pluginHost = new PluginHost({
    definitions: [{
      manifest: manifest("disabled-plugin"),
      defaultEnabled: false,
      start() {
        starts++;
      },
    }],
    logger,
    migrationRunner: async () => {
      migrations++;
    },
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });

  await pluginHost.initialize();
  assert.equal(pluginHost.list()[0]?.state, "disabled");
  assert.equal(migrations, 0);
  assert.equal(starts, 0);
  assert.throws(
    () => pluginHost.assertReady("disabled-plugin"),
    (error) => error instanceof PluginError && error.code === "PLUGIN_DISABLED"
  );
});

test("isolates a degraded plugin and continues initializing others", async () => {
  const pluginHost = host([
    {
      manifest: manifest("broken"),
      defaultEnabled: true,
      start() {
        throw new Error("startup failed");
      },
    },
    {
      manifest: manifest("healthy"),
      defaultEnabled: true,
    },
  ]);

  await pluginHost.initialize();
  const states = Object.fromEntries(
    pluginHost.list().map((plugin) => [plugin.id, plugin.state])
  );
  assert.deepEqual(states, { broken: "degraded", healthy: "ready" });
  assert.throws(
    () => pluginHost.assertReady("broken"),
    (error) => error instanceof PluginError && error.code === "PLUGIN_DEGRADED"
  );
});

test("degrades a plugin that registers a non-namespaced route", async () => {
  const pluginHost = host([{
    manifest: manifest("unsafe-route"),
    defaultEnabled: true,
    register(context) {
      context.registerRoute({
        method: "GET",
        path: "/api/unscoped",
        async handler() {
          return {};
        },
      });
    },
  }]);

  await pluginHost.initialize();
  assert.equal(pluginHost.list()[0]?.state, "degraded");
  assert.equal(pluginHost.routes().length, 0);
});

test("enforces declared permissions for external commands", async () => {
  const pluginHost = host([{
    manifest: manifest("no-exec"),
    defaultEnabled: true,
    async start(context) {
      await context.exec({ executable: "true", args: [] });
    },
  }]);

  await pluginHost.initialize();
  const [plugin] = pluginHost.list();
  assert.equal(plugin.state, "degraded");
  assert.equal(plugin.error?.code, "PLUGIN_DEPENDENCY_MISSING");
});

test("releases a scheduled job after a non-cooperative operation times out", async () => {
  let runs = 0;
  const signals: AbortSignal[] = [];
  const pluginHost = host([{
    manifest: manifest("hanging-job"),
    defaultEnabled: true,
    register(context) {
      context.registerJob({
        id: "hang",
        intervalMs: 5,
        timeoutMs: 10,
        run(signal) {
          runs++;
          signals.push(signal);
          return new Promise<void>(() => {});
        },
      });
    },
  }]);

  await pluginHost.initialize();
  const deadline = Date.now() + 250;
  while (runs < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(runs >= 2, "the scheduler should start another run after timeout");
  assert.equal(signals[0]?.aborted, true);
  assert.equal(pluginHost.list()[0]?.error?.code, "PLUGIN_TIMEOUT");
  await pluginHost.stop();
});

test("plugin doctor failures use a structured 503 response", async () => {
  const pluginHost = host([{
    manifest: manifest("unhealthy"),
    defaultEnabled: true,
    doctor() {
      return [{ id: "dependency", ok: false, message: "dependency failed" }];
    },
  }]);
  await pluginHost.initialize();
  const app = Fastify();
  await pluginRoutes(app, pluginHost);

  const response = await app.inject({ method: "GET", url: "/api/plugins/doctor" });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    error: "One or more enabled plugin checks failed",
    ok: false,
    plugins: [{
      id: "unhealthy",
      displayName: "unhealthy",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      configured: false,
      enabled: true,
      state: "ready",
      capabilities: [],
      permissions: [],
      failureCount: 0,
      checks: [{ id: "dependency", ok: false, message: "dependency failed" }],
    }],
  });

  await app.close();
  await pluginHost.stop();
});
