import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_API_VERSION,
  PluginError,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
} from "@echolog/plugin-sdk";
import { PluginHost } from "../src/core/plugins/host.js";

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
