import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import type { AppRule } from "../plugins/screen-time/src/schema.js";
import { classifySegment } from "../plugins/screen-time/src/screen.js";
import { createScreenRoutes } from "../plugins/screen-time/src/routes.js";
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
