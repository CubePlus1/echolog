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

function manifest(
  id: string,
  permissions: PluginManifest["permissions"] = []
): PluginManifest {
  return {
    manifestVersion: 1,
    id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    displayName: id,
    description: `${id} notification test plugin`,
    entries: { server: "./dist/server.js" },
    capabilities: [],
    permissions,
    requires: { coreApi: "^1.0.0" },
  };
}

function host(
  definitions: PluginDefinition[],
  services: Record<string, unknown> = {}
): PluginHost {
  return new PluginHost({
    definitions,
    logger,
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    services,
  });
}

test("denies notifications.send without its declared permission", async () => {
  let serviceCalls = 0;
  let deniedError: unknown;
  const pluginHost = host(
    [{
      manifest: manifest("notification-denied"),
      defaultEnabled: true,
      async start(context) {
        try {
          const send = context.service<(
            request: { title: string; message: string }
          ) => Promise<unknown>>("notifications.send");
          await send({ title: "private title", message: "private message" });
        } catch (error) {
          deniedError = error;
          throw error;
        }
      },
    }],
    {
      "notifications.send": async () => {
        serviceCalls++;
      },
    }
  );

  await pluginHost.initialize();

  const [plugin] = pluginHost.list();
  assert.equal(plugin?.state, "degraded");
  assert.equal(plugin?.error?.code, "PLUGIN_DEPENDENCY_MISSING");
  assert.ok(deniedError instanceof PluginError);
  assert.equal(deniedError.code, "PLUGIN_DEPENDENCY_MISSING");
  assert.equal(deniedError.statusCode, 403);
  assert.equal(deniedError.pluginId, "notification-denied");
  assert.equal(serviceCalls, 0);
});

test("returns the Core-owned send function to a permitted plugin", async () => {
  const requests: Array<{ title: string; message: string }> = [];
  const expected = {
    channels: {
      mac: { status: "sent" as const },
      ntfy: { status: "disabled" as const },
    },
  };
  let received: unknown;
  let receivedService: unknown;
  const send = async (request: { title: string; message: string }) => {
    requests.push(request);
    return expected;
  };
  const pluginHost = host(
    [{
      manifest: manifest("notification-allowed", ["notifications:send"]),
      defaultEnabled: true,
      async start(context) {
        const service = context.service<typeof send>("notifications.send");
        receivedService = service;
        received = await service({ title: "Reminder", message: "Stand up" });
      },
    }],
    { "notifications.send": send }
  );

  await pluginHost.initialize();

  assert.equal(pluginHost.list()[0]?.state, "ready");
  assert.equal(receivedService, send);
  assert.deepEqual(requests, [{ title: "Reminder", message: "Stand up" }]);
  assert.equal(received, expected);
});

test("does not run notification lifecycle hooks for a disabled plugin", async () => {
  const lifecycle = {
    migrations: 0,
    register: 0,
    start: 0,
    jobs: 0,
    stop: 0,
  };
  let serviceCalls = 0;
  const pluginHost = new PluginHost({
    definitions: [{
      manifest: manifest("notification-disabled", ["notifications:send"]),
      defaultEnabled: false,
      register(context) {
        lifecycle.register++;
        context.service("notifications.send");
        context.registerJob({
          id: "disabled-job",
          intervalMs: 1,
          async run() {
            lifecycle.jobs++;
          },
        });
      },
      start(context) {
        lifecycle.start++;
        context.service("notifications.send");
      },
      stop() {
        lifecycle.stop++;
      },
    }],
    logger,
    migrationRunner: async () => {
      lifecycle.migrations++;
    },
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    services: {
      "notifications.send": async () => {
        serviceCalls++;
      },
    },
  });

  await pluginHost.initialize();
  await pluginHost.stop();

  assert.equal(pluginHost.list()[0]?.state, "disabled");
  assert.deepEqual(lifecycle, {
    migrations: 0,
    register: 0,
    start: 0,
    jobs: 0,
    stop: 0,
  });
  assert.equal(serviceCalls, 0);
});

test("degrades an invalid disabled manifest without running lifecycle hooks", async () => {
  const lifecycle = {
    invalidMigrations: 0,
    invalidRegister: 0,
    invalidStart: 0,
    invalidJobs: 0,
    invalidStop: 0,
    healthyMigrations: 0,
    healthyStart: 0,
    healthyStop: 0,
  };
  const invalidDefinition: PluginDefinition = {
    manifest: {
      ...manifest("notification-invalid-disabled"),
      permissions: [
        "notifications:unsupported" as PluginManifest["permissions"][number],
      ],
    },
    defaultEnabled: false,
    register(context) {
      lifecycle.invalidRegister++;
      context.registerJob({
        id: "invalid-disabled-job",
        intervalMs: 1,
        async run() {
          lifecycle.invalidJobs++;
        },
      });
    },
    start() {
      lifecycle.invalidStart++;
    },
    stop() {
      lifecycle.invalidStop++;
    },
  };
  const pluginHost = new PluginHost({
    definitions: [
      invalidDefinition,
      {
        manifest: manifest("notification-healthy-after-invalid"),
        defaultEnabled: true,
        start() {
          lifecycle.healthyStart++;
        },
        stop() {
          lifecycle.healthyStop++;
        },
      },
    ],
    logger,
    migrationRunner: async (pluginId) => {
      if (pluginId === "notification-invalid-disabled") {
        lifecycle.invalidMigrations++;
      } else if (pluginId === "notification-healthy-after-invalid") {
        lifecycle.healthyMigrations++;
      }
    },
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
  });

  await pluginHost.initialize();

  const plugins = Object.fromEntries(
    pluginHost.list().map((plugin) => [plugin.id, plugin])
  );
  const invalid = plugins["notification-invalid-disabled"];
  assert.equal(invalid?.enabled, false);
  assert.equal(invalid?.state, "degraded");
  assert.equal(invalid?.error?.code, "PLUGIN_DEGRADED");
  assert.match(invalid?.error?.message ?? "", /unsupported/);
  assert.equal(invalid?.failureCount, 1);
  assert.ok(invalid?.lastErrorAt);
  assert.equal(plugins["notification-healthy-after-invalid"]?.state, "ready");
  assert.deepEqual(lifecycle, {
    invalidMigrations: 0,
    invalidRegister: 0,
    invalidStart: 0,
    invalidJobs: 0,
    invalidStop: 0,
    healthyMigrations: 1,
    healthyStart: 1,
    healthyStop: 0,
  });

  await pluginHost.stop();
  assert.equal(lifecycle.invalidStop, 0);
  assert.equal(lifecycle.healthyStop, 1);
});

test("isolates an unavailable notification service from later plugins", async () => {
  let healthyStarted = false;
  const pluginHost = host([
    {
      manifest: manifest("notification-unavailable", ["notifications:send"]),
      defaultEnabled: true,
      start(context) {
        context.service("notifications.send");
      },
    },
    {
      manifest: manifest("notification-healthy"),
      defaultEnabled: true,
      start() {
        healthyStarted = true;
      },
    },
  ]);

  await pluginHost.initialize();

  const states = Object.fromEntries(
    pluginHost.list().map(({ id, state }) => [id, state])
  );
  assert.deepEqual(states, {
    "notification-healthy": "ready",
    "notification-unavailable": "degraded",
  });
  assert.equal(healthyStarted, true);
});

test("one notification plugin failure does not block a healthy plugin", async () => {
  let healthyResult: unknown;
  const send = async (request: { title: string; message: string }) => {
    if (request.title === "fail") throw new Error("delivery adapter unavailable");
    return {
      channels: {
        mac: { status: "sent" as const },
        ntfy: { status: "sent" as const },
      },
    };
  };
  const pluginHost = host(
    [
      {
        manifest: manifest("notification-broken", ["notifications:send"]),
        defaultEnabled: true,
        async start(context) {
          await context.service<typeof send>("notifications.send")({
            title: "fail",
            message: "first plugin",
          });
        },
      },
      {
        manifest: manifest("notification-working", ["notifications:send"]),
        defaultEnabled: true,
        async start(context) {
          healthyResult = await context.service<typeof send>(
            "notifications.send"
          )({ title: "ok", message: "second plugin" });
        },
      },
    ],
    { "notifications.send": send }
  );

  await pluginHost.initialize();

  const states = Object.fromEntries(
    pluginHost.list().map(({ id, state }) => [id, state])
  );
  assert.deepEqual(states, {
    "notification-broken": "degraded",
    "notification-working": "ready",
  });
  assert.deepEqual(healthyResult, {
    channels: { mac: { status: "sent" }, ntfy: { status: "sent" } },
  });
});
