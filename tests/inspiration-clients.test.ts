import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspirationCliContribution,
  renderInspirationDailySummary,
} from "../plugins/inspiration/src/cli.js";
import { createPluginWebHost } from "../web/plugin-host.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const webModulePath = new URL("../plugins/inspiration/web/index.js", import.meta.url).href;

function escapeText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: unknown): string {
  return escapeText(value).replaceAll("'", "&#39;");
}

function runCli(configPath: string, args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(
      join(repoRoot, "node_modules/.bin/tsx"),
      [join(repoRoot, "src/cli/index.ts"), ...args],
      {
        cwd: repoRoot,
        env: { ...process.env, ECHOLOG_CONFIG_PATH: configPath },
      },
      (error, stdout, stderr) => resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      })
    );
  });
}

async function requestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

test("Inspiration CLI metadata and daily summary stay aggregate-only", () => {
  assert.deepEqual(inspirationCliContribution, {
    command: "inspiration",
    apiPrefix: "/api/plugins/inspiration",
  });
  assert.equal(renderInspirationDailySummary({ captured: 0, surfaced: 0, outcomes: {} }), null);
  const summary = renderInspirationDailySummary({
    captured: 2,
    surfaced: 3,
    outcomes: { viewed: 1, later: 2 },
  });
  assert.equal(summary, "捕捉 2 条，Flow 浮现 3 次。\n结果：查看 1、稍后 2。");
  assert.equal(summary?.includes("private inspiration body"), false);
});

test("Inspiration CLI is HTTP-thin and preserves raw JSON success and errors", async () => {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const captured = {
    id: "inspiration-1",
    version: 1,
    content: "试试更短的 onboarding",
    tags: ["product", "ux"],
    project: null,
    status: "inbox",
    createdAt: "2026-08-24T04:00:00.000Z",
    updatedAt: "2026-08-24T04:00:00.000Z",
    archivedAt: null,
    lastSurfacedAt: null,
  };
  const conflict = {
    error: "inspiration version conflict",
    code: "VERSION_CONFLICT",
    currentVersion: 2,
  };
  const disabled = {
    error: "Plugin inspiration is disabled",
    code: "PLUGIN_DISABLED",
    pluginId: "inspiration",
  };
  const server = createServer(async (request, response) => {
    const body = await requestBody(request);
    calls.push({ method: request.method ?? "", url: request.url ?? "", body });
    if (request.url?.endsWith("/conflict")) {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify(conflict));
      return;
    }
    if (request.url === "/api/plugins/inspiration/flow/settings") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify(disabled));
      return;
    }
    if (request.url === "/api/plugins/inspiration/flow/next") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ candidate: null, explanation: ["daily-limit"] }));
      return;
    }
    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify(captured));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const temporary = await mkdtemp(join(tmpdir(), "echolog-inspiration-cli-"));
  const configPath = join(temporary, "config.yaml");
  await writeFile(configPath, `server:\n  port: ${address.port}\n  host: localhost\n`);

  try {
    const capture = await runCli(configPath, [
      "--json",
      "inspiration",
      "capture",
      captured.content,
      "--tags",
      "product,ux",
    ]);
    assert.equal(capture.exitCode, 0);
    assert.equal(capture.stderr, "");
    assert.deepEqual(JSON.parse(capture.stdout), captured);
    assert.deepEqual(calls[0], {
      method: "POST",
      url: "/api/plugins/inspiration/inspirations",
      body: {
        content: captured.content,
        tags: ["product", "ux"],
        project: null,
        status: "inbox",
      },
    });

    const next = await runCli(configPath, [
      "inspiration",
      "flow",
      "next",
      "--idempotency-key",
      "manual-test",
      "--json",
    ]);
    assert.equal(next.exitCode, 0);
    assert.deepEqual(JSON.parse(next.stdout), {
      candidate: null,
      explanation: ["daily-limit"],
    });
    assert.deepEqual(calls[1], {
      method: "POST",
      url: "/api/plugins/inspiration/flow/next",
      body: { idempotencyKey: "manual-test" },
    });

    const failed = await runCli(configPath, [
      "inspiration",
      "show",
      "conflict",
      "--json",
    ]);
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.stdout, "");
    assert.deepEqual(JSON.parse(failed.stderr), conflict);

    const unavailable = await runCli(configPath, [
      "inspiration",
      "flow",
      "settings",
      "--json",
    ]);
    assert.equal(unavailable.exitCode, 1);
    assert.equal(unavailable.stdout, "");
    assert.deepEqual(JSON.parse(unavailable.stderr), disabled);

    const help = await runCli(configPath, ["inspiration", "flow", "outcome", "--help"]);
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /viewed \| continued \| kept \| later \| archived/);
    assert.match(help.stdout, /--delivery-version/);
    assert.match(help.stdout, /--inspiration-version/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()
    ));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Inspiration Web contributes only while ready", async () => {
  let state = "disabled";
  const host = createPluginWebHost(async (path: string) => {
    assert.equal(path, "/plugins");
    return {
      plugins: [{
        id: "inspiration",
        enabled: state !== "disabled",
        state,
        webEntry: webModulePath,
      }],
    };
  });
  const api = async () => ({ items: [] });

  await host.refresh({ api });
  assert.deepEqual(host.faces(), []);
  state = "degraded";
  await host.refresh({ api });
  assert.deepEqual(host.faces(), []);
  state = "ready";
  await host.refresh({ api });
  assert.deepEqual(host.faces(), [
    { type: "inspiration-inbox" },
    { type: "inspiration-flow" },
  ]);
  state = "disabled";
  await host.refresh({ api });
  assert.deepEqual(host.faces(), []);
  await host.stop();
});

test("Inspiration Web uses canonical APIs, escapes DTOs, and delegates Flow policy", async () => {
  const { activate } = await import(webModulePath);
  const malicious = '<img src=x onerror="alert(1)">';
  const inspiration = {
    id: "inspiration-1",
    version: 3,
    content: malicious,
    tags: ["<script>alert(2)</script>"],
    project: 'Project "quoted"',
    status: "inbox",
    createdAt: "2026-08-24T04:00:00.000Z",
    updatedAt: "2026-08-24T04:00:00.000Z",
    archivedAt: null,
    lastSurfacedAt: null,
  };
  const delivery = {
    id: "delivery-1",
    version: 1,
    attempts: 1,
    inspirationId: inspiration.id,
    source: "manual",
    dedupeKey: "manual:test",
    status: "sent",
    outcome: null,
    surfacedAt: "2026-08-24T05:00:00.000Z",
    notifiedAt: null,
    snoozedUntil: null,
    outcomeAt: null,
    notificationChannel: null,
    notificationChannels: {
      mac: { status: "sent" },
      ntfy: { status: "disabled" },
    },
    error: null,
    createdAt: "2026-08-24T05:00:00.000Z",
    updatedAt: "2026-08-24T05:00:00.000Z",
  };
  const settings = {
    id: "default",
    version: 2,
    enabled: true,
    intervalMinutes: 180,
    quietStartMinute: 1320,
    quietEndMinute: 480,
    cooldownMinutes: 1440,
    dailyLimit: 3,
    defaultSnoozeMinutes: 120,
    statuses: ["inbox", "kept"],
    tags: [],
    projects: [],
    updatedAt: "2026-08-24T04:00:00.000Z",
  };
  const calls: Array<{ path: string; options?: { method?: string; body?: string } }> = [];
  const api = async (path: string, options?: { method?: string; body?: string }) => {
    calls.push({ path, options });
    if (path.includes("/inspirations?") && !options) {
      return { items: [inspiration], nextCursor: null };
    }
    if (path.endsWith("/flow/settings") && !options) return settings;
    if (path.includes("/flow/deliveries?") && !options) return { deliveries: [delivery] };
    if (path.endsWith("/flow/next")) {
      return {
        candidate: {
          inspiration,
          delivery,
          explanation: ["never surfaced", malicious],
          duplicate: false,
        },
        explanation: [],
      };
    }
    return { ...inspiration, version: inspiration.version + 1 };
  };
  const contribution = await activate({ api });
  const data = await contribution.load();
  assert.deepEqual(calls.slice(0, 3).map((call) => call.path), [
    "/plugins/inspiration/inspirations?limit=50&status=inbox&status=kept",
    "/plugins/inspiration/flow/settings",
    "/plugins/inspiration/flow/deliveries?limit=20",
  ]);
  assert.deepEqual(Object.keys(data).sort(), [
    "inspirationFlowDeliveries",
    "inspirationFlowSettings",
    "inspirationList",
  ]);

  const inboxHtml = contribution.renderFace(
    { type: "inspiration-inbox" },
    { data, esc: escapeText, escA: escapeAttribute }
  );
  assert.equal(inboxHtml.includes(malicious), false);
  assert.equal(inboxHtml.includes("<script>alert(2)</script>"), false);
  assert.match(inboxHtml, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(inboxHtml, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);

  const elements: Record<string, { value?: string; checked?: boolean; textContent?: string }> = {
    inspirationNewContent: { value: "new idea" },
    inspirationNewTags: { value: "Product, UX" },
    inspirationNewProject: { value: "EchoLog" },
    inspirationNewError: { textContent: "" },
  };
  const $ = (id: string) => elements[id] ?? null;
  const captureResult = await contribution.handleAction("capture-inspiration", { id: undefined, $ });
  assert.equal(captureResult.handled, true);
  assert.deepEqual(calls.at(-1), {
    path: "/plugins/inspiration/inspirations",
    options: {
      method: "POST",
      body: JSON.stringify({
        content: "new idea",
        tags: ["Product", "UX"],
        project: "EchoLog",
        status: "inbox",
      }),
    },
  });

  Object.assign(elements, {
    "inspirationContent:inspiration-1": { value: "edited idea" },
    "inspirationTags:inspiration-1": { value: "edited,idea" },
    "inspirationProject:inspiration-1": { value: "Project B" },
    "inspirationStatus:inspiration-1": { value: "kept" },
    "inspirationError:inspiration-1": { textContent: "" },
  });
  await contribution.handleAction("edit-inspiration", { id: inspiration.id, $ });
  assert.deepEqual(calls.at(-1), {
    path: "/plugins/inspiration/inspirations/inspiration-1",
    options: {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: 3,
        content: "edited idea",
        tags: ["edited", "idea"],
        project: "Project B",
        status: "kept",
      }),
    },
  });
  await contribution.handleAction("archive-inspiration", { id: inspiration.id, $ });
  assert.deepEqual(calls.at(-1), {
    path: "/plugins/inspiration/inspirations/inspiration-1/archive",
    options: {
      method: "POST",
      body: JSON.stringify({ expectedVersion: 3 }),
    },
  });

  Object.assign(elements, {
    inspirationFilterText: { value: "edited" },
    inspirationFilterTags: { value: "ux, Product" },
    inspirationFilterProject: { value: "EchoLog" },
    inspirationFilterInbox: { checked: false },
    inspirationFilterKept: { checked: true },
    inspirationFilterArchived: { checked: true },
    inspirationIncludeArchived: { checked: true },
  });
  await contribution.handleAction("filter-inspirations", { id: undefined, $ });
  await contribution.load();
  assert.equal(
    calls.at(-3)?.path,
    "/plugins/inspiration/inspirations?limit=50&text=edited&tag=ux&tag=Product&project=EchoLog&status=kept&status=archived&includeArchived=true"
  );

  Object.assign(elements, {
    inspirationFlowEnabled: { checked: false },
    inspirationFlowInterval: { value: "240" },
    inspirationFlowQuietStart: { value: "23:00" },
    inspirationFlowQuietEnd: { value: "07:30" },
    inspirationFlowCooldown: { value: "720" },
    inspirationFlowDailyLimit: { value: "4" },
    inspirationFlowDefaultSnooze: { value: "60" },
    inspirationFlowStatusInbox: { checked: true },
    inspirationFlowStatusKept: { checked: false },
    inspirationFlowTags: { value: "ux, product" },
    inspirationFlowProjects: { value: "EchoLog" },
    inspirationSettingsError: { textContent: "" },
  });
  await contribution.handleAction("save-inspiration-settings", { id: undefined, $ });
  assert.deepEqual(calls.at(-1), {
    path: "/plugins/inspiration/flow/settings",
    options: {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: 2,
        enabled: false,
        intervalMinutes: 240,
        quietStartMinute: 1380,
        quietEndMinute: 450,
        cooldownMinutes: 720,
        dailyLimit: 4,
        defaultSnoozeMinutes: 60,
        statuses: ["inbox"],
        tags: ["ux", "product"],
        projects: ["EchoLog"],
      }),
    },
  });

  await contribution.handleAction("next-inspiration", { id: undefined, $ });
  const flowHtml = contribution.renderFace(
    { type: "inspiration-flow" },
    { data, esc: escapeText, escA: escapeAttribute }
  );
  assert.equal(flowHtml.includes(malicious), false);
  assert.match(flowHtml, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  elements.inspirationSnooze = { value: "90" };
  elements.inspirationFlowError = { textContent: "" };
  const outcomeResult = await contribution.handleAction("inspiration-outcome-later", {
    id: delivery.id,
    $,
  });
  assert.equal(outcomeResult.handled, true);
  assert.deepEqual(calls.at(-1), {
    path: "/plugins/inspiration/flow/deliveries/delivery-1/outcome",
    options: {
      method: "POST",
      body: JSON.stringify({
        expectedDeliveryVersion: 1,
        expectedInspirationVersion: 3,
        outcome: "later",
        snoozeMinutes: 90,
      }),
    },
  });
  assert.equal(calls.every((call) => call.path.startsWith("/plugins/inspiration")), true);
});

test("Inspiration client sources contain no scheduling conversion surface", async () => {
  const web = await readFile(join(repoRoot, "plugins/inspiration/web/index.js"), "utf8");
  const pluginCli = await readFile(join(repoRoot, "plugins/inspiration/src/cli.ts"), "utf8");
  const rootCli = await readFile(join(repoRoot, "src/cli/index.ts"), "utf8");
  const start = rootCli.indexOf("type InspirationLifecycleStatus");
  const end = rootCli.indexOf("// el screen [date]", start);
  assert.ok(start >= 0 && end > start);
  const inspirationRegistration = rootCli.slice(start, end);
  for (const source of [web, pluginCli, inspirationRegistration]) {
    assert.doesNotMatch(source, /schedule|转为日程|安排日程|日程 API/i);
  }
});
