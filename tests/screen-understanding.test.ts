import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderProfile } from "../plugins/screen-time/src/provider-profiles.js";
import {
  ScreenUnderstandingService,
  UnderstandingError,
  parseUnderstandingResult,
} from "../plugins/screen-time/src/understanding.js";
import {
  buildVisionRequestPayload,
  OpenAICompatibleVisionClient,
  VisionProviderError,
} from "../plugins/screen-time/src/vision-provider.js";
import { MacKeychainClient } from "../plugins/screen-time/src/macos-keychain-client.js";
import { createScreenRoutes } from "../plugins/screen-time/src/routes.js";
import { DEFAULT_UNDERSTANDING_SETTINGS } from "../plugins/screen-time/src/understanding-settings.js";

const profile: ProviderProfile = {
  id: "vision-primary",
  version: 1,
  displayName: "Primary vision",
  providerKind: "openai-compatible",
  baseUrl: "https://vision.example.com/v1",
  model: "vision-model",
  hasApiKey: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("vision payload carries an in-memory data URL and never the API key", () => {
  const payload = buildVisionRequestPayload(profile, Buffer.from("png-bytes"));
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /data:image\/png;base64/);
  assert.equal(serialized.includes("secret-key"), false);
  assert.equal((payload as { model: string }).model, "vision-model");
});

test("Keychain client reads a secret only through the helper response", async () => {
  const requests: string[][] = [];
  const client = new MacKeychainClient(async (request) => {
    requests.push(request.args);
    return {
      stdout: JSON.stringify(
        request.args[1] === "get"
          ? { ok: true, hasSecret: true, secret: "secret-value" }
          : { ok: true, hasSecret: request.args[1] !== "delete" }
      ),
      stderr: "",
      exitCode: 0,
    };
  }, "/test/EchoLogScreenCapture.app/Contents/MacOS/echolog-screen-capture");
  assert.equal(await client.get("vision-primary"), "secret-value");
  assert.equal(requests[0]?.includes("secret-value"), false);
  assert.equal(requests[0]?.[1], "get");
});

test("vision client accepts OpenAI-compatible JSON and maps provider failures safely", async () => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (_input, init) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"summary":"写代码","activity":"编辑 TypeScript","confidence":0.9,"sensitive":false,"apps":["Codex"]}' } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await new OpenAICompatibleVisionClient().complete(
      profile,
      "secret-key",
      Buffer.from("png"),
      1_000
    );
    assert.equal(result.content.includes("写代码"), true);
    const requestBody = JSON.parse(String(calls[0]?.body));
    assert.equal(calls[0]?.headers instanceof Headers, false);
    assert.equal(requestBody.messages[1].content[1].image_url.detail, "low");
    assert.equal(String(calls[0]?.headers).includes("secret-key"), false);

    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await assert.rejects(
      new OpenAICompatibleVisionClient().complete(profile, "secret-key", Buffer.from("png"), 1_000),
      (error) => error instanceof VisionProviderError && error.code === "PROVIDER_AUTH" && error.statusCode === 502
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("understanding parser rejects extra fields and normalizes fenced JSON", () => {
  const result = parseUnderstandingResult('```json\n{"summary":" 阅读文档 ","activity":"阅读","confidence":0.8,"sensitive":false,"apps":["浏览器","浏览器"]}\n```');
  assert.deepEqual(result, {
    summary: "阅读文档",
    activity: "阅读",
    confidence: 0.8,
    sensitive: false,
    apps: ["浏览器"],
  });
  assert.throws(
    () => parseUnderstandingResult('{"summary":"x","activity":"y","confidence":0.8,"sensitive":false,"apps":[],"extra":"no"}'),
    (error) => error instanceof UnderstandingError && error.code === "UNDERSTANDING_RESPONSE_INVALID"
  );
});

function makeStore() {
  const requests: Array<{ id: string; requestedAt: Date; costMicros: number }> = [];
  const observations: any[] = [];
  return {
    requests,
    observations,
    async countUnderstandingRequestsBetween(start: Date, end: Date) {
      return requests.filter((item) => item.requestedAt >= start && item.requestedAt < end).length;
    },
    async costUnderstandingRequestsBetween(start: Date, end: Date) {
      return requests
        .filter((item) => item.requestedAt >= start && item.requestedAt < end)
        .reduce((total, item) => total + item.costMicros, 0);
    },
    async createUnderstandingRequest(input: { id: string; requestedAt: Date }) {
      requests.push({ ...input, costMicros: 0 });
    },
    async completeUnderstandingRequest(id: string, _status: string, _completedAt: Date, costMicros: number | null) {
      const item = requests.find((candidate) => candidate.id === id);
      if (item && costMicros != null) item.costMicros = costMicros;
    },
    async createUnderstandingObservation(input: any) {
      const row = { ...input };
      observations.push(row);
      return row;
    },
    async latestUnderstandingObservation() { return observations.at(-1) ?? null; },
    async listUnderstandingObservations(limit: number) { return observations.slice(-limit).reverse(); },
  };
}

test("understanding service captures, retries transient provider failures, and persists redacted results", async () => {
  const store = makeStore();
  let attempts = 0;
  let captures = 0;
  const settings = {
    async get() {
      return { id: "default", version: 1, ...DEFAULT_UNDERSTANDING_SETTINGS, enabled: true, providerProfileId: profile.id, maxAttempts: 2, updatedAt: new Date() };
    },
  };
  const service = new ScreenUnderstandingService(
    store,
    settings as any,
    { async getForInference() { return { profile, apiKey: "secret-key" }; } },
    { async captureForInference() { captures++; return { format: "png", displayId: 1, widthPixels: 1, heightPixels: 1, bytes: 3, capturedAt: new Date().toISOString(), png: Buffer.from("png") }; } },
    { async complete() {
      attempts++;
      if (attempts === 1) throw new VisionProviderError("PROVIDER_UNAVAILABLE", "temporary", 502, true);
      return { content: '{"summary":"编辑代码","activity":"编写功能","confidence":0.95,"sensitive":false,"apps":["Codex"]}', latencyMs: 12, costMicros: null };
    } },
    { isIdle() { return false; } },
    () => new Date("2026-08-20T10:00:00+08:00")
  );
  const result = await service.run();
  assert.equal(captures, 1);
  assert.equal(attempts, 2);
  assert.equal(store.requests.length, 2);
  assert.equal(result.summary, "编辑代码");
  assert.equal(result.apps[0], "Codex");
  assert.equal(JSON.stringify(result).includes("secret-key"), false);
});

test("disabled understanding does not capture or call the provider", async () => {
  let captures = 0;
  let calls = 0;
  const service = new ScreenUnderstandingService(
    makeStore(),
    { async get() { return { id: "default", version: 1, ...DEFAULT_UNDERSTANDING_SETTINGS, enabled: false, updatedAt: new Date() }; } } as any,
    { async getForInference() { throw new Error("must not resolve provider"); } },
    { async captureForInference() { captures++; throw new Error("must not capture"); } },
    { async complete() { calls++; throw new Error("must not call"); } },
  );
  await assert.rejects(
    service.run(),
    (error) => error instanceof UnderstandingError && error.code === "UNDERSTANDING_DISABLED"
  );
  assert.equal(captures, 0);
  assert.equal(calls, 0);
});

test("understanding routes expose local run and safe history endpoints", async () => {
  const service = {
    async run() { return { id: "obs", summary: "ok" }; },
    async latest() { return null; },
    async history() { return []; },
  };
  const routes = createScreenRoutes(
    (() => ({})) as any,
    undefined,
    undefined,
    undefined,
    () => service as any
  );
  const run = routes.find((route) => route.path.endsWith("/understanding/run"));
  const latest = routes.find((route) => route.path.endsWith("/understanding/latest"));
  assert.equal(run?.localOnly, true);
  assert.deepEqual(await run?.handler({ params: {}, query: {}, body: {} , headers: {} }, new AbortController().signal), { id: "obs", summary: "ok" });
  assert.deepEqual(await latest?.handler({ params: {}, query: {}, body: null, headers: {} }, new AbortController().signal), null);
});
