import assert from "node:assert/strict";
import test from "node:test";
import {
  PluginError,
  type PluginDefinition,
  type PluginLogger,
  type PluginManifest,
  type PluginNotificationResult,
  type PluginNotificationSend,
} from "@echolog/plugin-sdk";
import inspirationManifestJson from "../plugins/inspiration/echolog.plugin.json" with { type: "json" };
import type {
  FlowNotificationFinalization,
  FlowReserveResult,
} from "../plugins/inspiration/src/flow-store.js";
import {
  FlowService,
  type FlowPersistence,
} from "../plugins/inspiration/src/flow.js";
import { notificationsSendProvider } from "../plugins/inspiration/src/notifications.js";
import type {
  FlowCandidate,
  FlowDelivery,
  FlowSettings,
  Inspiration,
} from "../plugins/inspiration/src/types.js";
import { PluginHost } from "../src/core/plugins/host.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const manifest = inspirationManifestJson as PluginManifest;

const logger: PluginLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function host(
  definition: PluginDefinition,
  services: Record<string, unknown> = {}
): PluginHost {
  return new PluginHost({
    definitions: [definition],
    logger,
    migrationRunner: async () => {},
    commandRunner: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    services,
  });
}

function inspiration(): Inspiration {
  return {
    id: "idea-host",
    version: 2,
    content: "A Host-integrated inspiration",
    tags: [],
    project: null,
    status: "inbox",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    lastSurfacedAt: NOW,
  };
}

function delivery(overrides: Partial<FlowDelivery> = {}): FlowDelivery {
  return {
    id: "delivery-host",
    version: 1,
    attempts: 1,
    inspirationId: "idea-host",
    source: "manual",
    dedupeKey: "manual:host",
    status: "reserved",
    outcome: null,
    surfacedAt: NOW,
    notifiedAt: null,
    snoozedUntil: null,
    outcomeAt: null,
    notificationChannel: null,
    notificationChannels: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function candidate(): FlowCandidate {
  return {
    inspiration: inspiration(),
    delivery: delivery(),
    explanation: ["selection:never-surfaced-first"],
    duplicate: false,
  };
}

function settings(): FlowSettings {
  return {
    id: "default",
    version: 1,
    enabled: true,
    intervalMinutes: 60,
    quietStartMinute: 0,
    quietEndMinute: 0,
    cooldownMinutes: 0,
    dailyLimit: 3,
    defaultSnoozeMinutes: 120,
    statuses: ["inbox", "kept"],
    tags: [],
    projects: [],
    updatedAt: NOW,
  };
}

function persistence(
  onFinalize: (result: FlowNotificationFinalization) => void
): FlowPersistence {
  return {
    async getSettings() {
      return settings();
    },
    async updateSettings() {
      return settings();
    },
    async reserveNext(): Promise<FlowReserveResult> {
      const selected = candidate();
      return {
        candidate: selected,
        explanation: selected.explanation,
        shouldNotify: true,
      };
    },
    async claimNotification() {
      return delivery({ version: 2, status: "dispatching" });
    },
    async finalizeNotification(_id, _version, result) {
      onFinalize(result);
      return delivery({
        version: 3,
        status: result.delivered ? "sent" : "failed",
        notifiedAt: result.delivered ? result.at : null,
        notificationChannels: result.channels,
        error: result.delivered ? null : result.error,
      });
    },
    async listDeliveries() {
      return { deliveries: [], nextCursor: null };
    },
    async applyOutcome() {
      return { delivery: delivery(), inspiration: inspiration() };
    },
    async getDailySummary() {
      return { captured: 0, surfaced: 0, outcomes: {} };
    },
  };
}

test("real PluginHost denies the actual Inspiration provider without permission", async () => {
  let serviceCalls = 0;
  let denied: unknown;
  const send: PluginNotificationSend = async () => {
    serviceCalls += 1;
    return {
      channels: {
        mac: { status: "sent" },
        ntfy: { status: "sent" },
      },
    };
  };
  const deniedManifest: PluginManifest = {
    ...manifest,
    permissions: manifest.permissions.filter(
      (permission) => permission !== "notifications:send"
    ),
  };
  const pluginHost = host({
    manifest: deniedManifest,
    defaultEnabled: true,
    async start(context) {
      try {
        await notificationsSendProvider(context)()({
          title: "Inspiration",
          message: "must not leave the Host",
        });
      } catch (error) {
        denied = error;
        throw error;
      }
    },
  }, { "notifications.send": send });

  await pluginHost.initialize();

  assert.ok(denied instanceof PluginError);
  assert.equal(denied.code, "PLUGIN_DEPENDENCY_MISSING");
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.pluginId, "inspiration");
  assert.equal(pluginHost.list()[0]?.state, "degraded");
  assert.equal(serviceCalls, 0);
});

test("actual Inspiration provider passes a bare Host function with a stable dedupe key", async () => {
  const requests: unknown[] = [];
  const finalizations: FlowNotificationFinalization[] = [];
  const send: PluginNotificationSend = async (request) => {
    requests.push(request);
    return {
      channels: {
        mac: { status: "sent" },
        ntfy: { status: "disabled" },
      },
    };
  };
  assert.equal("send" in send, false);
  const pluginHost = host({
    manifest,
    defaultEnabled: true,
    async start(context) {
      const flow = new FlowService(
        persistence((result) => finalizations.push(result)),
        notificationsSendProvider(context),
        () => NOW
      );
      await flow.nextManual("host-contract");
    },
  }, { "notifications.send": send });

  await pluginHost.initialize();

  assert.equal(pluginHost.list()[0]?.state, "ready");
  assert.deepEqual(requests, [{
    title: "Inspiration",
    message: "A Host-integrated inspiration",
    dedupeKey: "inspiration:manual:host",
  }]);
  assert.deepEqual(finalizations, [{
    delivered: true,
    channels: {
      mac: { status: "sent" },
      ntfy: { status: "disabled" },
    },
    at: NOW,
  }]);
});

test("real Host channel results drive Inspiration delivery status", async () => {
  const cases: Array<{
    name: string;
    result: PluginNotificationResult;
    delivered: boolean;
  }> = [
    {
      name: "failed plus sent",
      result: {
        channels: {
          mac: { status: "failed", error: "mac notification failed" },
          ntfy: { status: "sent" },
        },
      },
      delivered: true,
    },
    {
      name: "all disabled",
      result: {
        channels: {
          mac: { status: "disabled" },
          ntfy: { status: "disabled" },
        },
      },
      delivered: false,
    },
    {
      name: "failed plus disabled",
      result: {
        channels: {
          mac: { status: "failed", error: "mac notification failed" },
          ntfy: { status: "disabled" },
        },
      },
      delivered: false,
    },
  ];

  for (const item of cases) {
    let finalized: FlowNotificationFinalization | undefined;
    const send: PluginNotificationSend = async () => item.result;
    const pluginHost = host({
      manifest,
      defaultEnabled: true,
      async start(context) {
        const flow = new FlowService(
          persistence((result) => {
            finalized = result;
          }),
          notificationsSendProvider(context),
          () => NOW
        );
        await flow.nextManual(item.name);
      },
    }, { "notifications.send": send });

    await pluginHost.initialize();

    assert.equal(pluginHost.list()[0]?.state, "ready", item.name);
    assert.equal(finalized?.delivered, item.delivered, item.name);
    assert.deepEqual(finalized?.channels, item.result.channels, item.name);
  }
});

test("lazy missing service leaves Host ready until Flow records a generic failure", async () => {
  let provider: ReturnType<typeof notificationsSendProvider> | undefined;
  const finalizations: FlowNotificationFinalization[] = [];
  const pluginHost = host({
    manifest,
    defaultEnabled: true,
    register(context) {
      provider = notificationsSendProvider(context);
    },
  });

  await pluginHost.initialize();
  assert.equal(pluginHost.list()[0]?.state, "ready");
  assert.ok(provider);

  const flow = new FlowService(
    persistence((result) => finalizations.push(result)),
    provider,
    () => NOW
  );
  const result = await flow.nextManual("missing-service");

  assert.equal(result.candidate?.delivery.status, "failed");
  assert.deepEqual(finalizations, [{
    delivered: false,
    channels: null,
    error: "notifications.send failed",
    at: NOW,
  }]);
  assert.equal(pluginHost.list()[0]?.state, "ready");
});
