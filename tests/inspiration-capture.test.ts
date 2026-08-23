import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PluginHttpRequest, PluginRoute } from "@echolog/plugin-sdk";
import manifest from "../plugins/inspiration/echolog.plugin.json" with { type: "json" };
import { migrations } from "../plugins/inspiration/src/migrations.js";
import {
  createInspirationRoutes,
  type InspirationCaptureStore,
} from "../plugins/inspiration/src/routes.js";
import {
  InspirationStoreError,
  type InspirationPage,
  type InspirationStoreListFilter,
} from "../plugins/inspiration/src/store.js";
import type {
  CreateInspirationInput,
  Inspiration,
  InspirationStatus,
  UpdateInspirationInput,
} from "../plugins/inspiration/src/types.js";

const now = new Date("2026-08-24T01:00:00.000Z");

function row(overrides: Partial<Inspiration> = {}): Inspiration {
  return {
    id: "capture_001",
    version: 1,
    content: "A durable idea",
    tags: ["design"],
    project: "EchoLog",
    status: "inbox",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    lastSurfacedAt: null,
    ...overrides,
  };
}

class MemoryCaptureStore implements InspirationCaptureStore {
  readonly rows = new Map<string, Inspiration>();
  lastCreate: CreateInspirationInput | null = null;
  lastFilter: InspirationStoreListFilter | null = null;

  async create(input: CreateInspirationInput): Promise<Inspiration> {
    this.lastCreate = input;
    const created = row({
      id: `capture_${String(this.rows.size + 1).padStart(3, "0")}`,
      content: input.content,
      tags: input.tags,
      project: input.project,
      status: input.status,
    });
    this.rows.set(created.id, created);
    return created;
  }

  async get(id: string): Promise<Inspiration | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter: InspirationStoreListFilter): Promise<InspirationPage> {
    this.lastFilter = filter;
    const items = [...this.rows.values()]
      .filter((item) => filter.includeArchived || item.status !== "archived")
      .filter((item) => !filter.statuses?.length || filter.statuses.includes(item.status))
      .filter((item) => filter.project === undefined || item.project === filter.project)
      .filter((item) => !filter.tags?.length || filter.tags.every((tag) => item.tags.includes(tag)))
      .filter((item) => !filter.text || item.content.toLowerCase().includes(filter.text.toLowerCase()))
      .filter((item) => !filter.before || item.createdAt < filter.before)
      .filter((item) => !filter.after || item.createdAt > filter.after)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, filter.limit);
    return { items, nextCursor: null };
  }

  async update(id: string, input: UpdateInspirationInput): Promise<Inspiration> {
    const current = this.requireCurrent(id, input.expectedVersion);
    if (current.status === "archived") {
      throw new InspirationStoreError(
        "INSPIRATION_INVALID_STATE",
        `Inspiration ${id} cannot be updated from status archived`,
        409,
        current.version
      );
    }
    const updated = {
      ...current,
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.project === undefined ? {} : { project: input.project }),
      ...(input.status === undefined ? {} : { status: input.status }),
      version: current.version + 1,
      updatedAt: new Date(now.getTime() + current.version),
    };
    this.rows.set(id, updated);
    return updated;
  }

  async archive(id: string, expectedVersion: number): Promise<Inspiration> {
    const current = this.requireCurrent(id, expectedVersion);
    if (current.status === "archived") {
      throw new InspirationStoreError(
        "INSPIRATION_INVALID_STATE",
        `Inspiration ${id} cannot be archived from status archived`,
        409,
        current.version
      );
    }
    const archived = {
      ...current,
      version: current.version + 1,
      status: "archived" as const,
      archivedAt: now,
      updatedAt: now,
    };
    this.rows.set(id, archived);
    return archived;
  }

  async restore(
    id: string,
    expectedVersion: number,
    status: Exclude<InspirationStatus, "archived">
  ): Promise<Inspiration> {
    const current = this.requireCurrent(id, expectedVersion);
    if (current.status !== "archived") {
      throw new InspirationStoreError(
        "INSPIRATION_INVALID_STATE",
        `Inspiration ${id} cannot be restored from status ${current.status}`,
        409,
        current.version
      );
    }
    const restored = {
      ...current,
      version: current.version + 1,
      status,
      archivedAt: null,
      updatedAt: now,
    };
    this.rows.set(id, restored);
    return restored;
  }

  private requireCurrent(id: string, expectedVersion: number): Inspiration {
    const current = this.rows.get(id);
    if (!current) {
      throw new InspirationStoreError(
        "INSPIRATION_NOT_FOUND",
        `Inspiration ${id} not found`,
        404
      );
    }
    if (current.version !== expectedVersion) {
      throw new InspirationStoreError(
        "INSPIRATION_VERSION_CONFLICT",
        `Inspiration ${id} has changed`,
        409,
        current.version
      );
    }
    return current;
  }
}

function route(
  routes: PluginRoute[],
  method: PluginRoute["method"],
  path: string
): PluginRoute {
  const found = routes.find((candidate) =>
    candidate.method === method && candidate.path === path
  );
  assert.ok(found, `${method} ${path} route is registered`);
  return found;
}

async function call(
  handler: PluginRoute["handler"],
  partial: Partial<PluginHttpRequest> = {}
): Promise<any> {
  return handler({
    params: {},
    query: {},
    body: undefined,
    headers: {},
    ...partial,
  }, new AbortController().signal);
}

test("manifest and migrations define one private standalone plugin schema", () => {
  assert.equal(manifest.id, "inspiration");
  assert.deepEqual(manifest.permissions, [
    "database:plugin",
    "notifications:send",
  ]);
  assert.deepEqual(migrations.map((migration) => migration.name), [
    "001_inspirations",
    "002_inspiration_flow_settings",
    "003_inspiration_flow_deliveries",
    "004_inspiration_flow_delivery_attempts",
    "005_inspiration_flow_notification_channels",
  ]);
  const sql = migrations.map((migration) => migration.sql).join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inspirations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inspiration_flow_settings/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inspiration_flow_deliveries/);
  assert.match(sql, /dedupe_key[\s\S]*CREATE UNIQUE INDEX/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS notification_channels JSONB/);
  assert.match(sql, /inspiration_id TEXT NOT NULL REFERENCES inspirations\(id\)/);
  assert.match(sql, /CHECK \(\(status = 'archived'\) = \(archived_at IS NOT NULL\)\)/);
  assert.doesNotMatch(sql, /REFERENCES\s+(records|tasks|schedule)/i);
  assert.doesNotMatch(sql, /\/api\/(schedule|records)/i);
});

test("capture validates and normalizes input without requiring Core state", async () => {
  const store = new MemoryCaptureStore();
  const routes = createInspirationRoutes(() => store);
  const result = await call(
    route(routes, "POST", "/api/plugins/inspiration/inspirations").handler,
    {
      body: {
        content: "  Build a quiet inbox  ",
        tags: [" Product ", "product", "Ideas"],
        project: " EchoLog ",
      },
    }
  );
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.content, "Build a quiet inbox");
  assert.deepEqual(result.body.tags, ["ideas", "product"]);
  assert.deepEqual(store.lastCreate, {
    content: "Build a quiet inbox",
    tags: ["ideas", "product"],
    project: "EchoLog",
    status: "inbox",
  });
});

test("capture routes reject unknown fields and invalid archived creation", async () => {
  const routes = createInspirationRoutes(() => new MemoryCaptureStore());
  const handler = route(
    routes,
    "POST",
    "/api/plugins/inspiration/inspirations"
  ).handler;
  const unknown = await call(handler, {
    body: { content: "Idea", scheduleId: "outside-scope" },
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.code, "INSPIRATION_VALIDATION_ERROR");
  const archived = await call(handler, {
    body: { content: "Idea", status: "archived" },
  });
  assert.equal(archived.statusCode, 400);
});

test("list normalizes filters and preserves deterministic history contract", async () => {
  const store = new MemoryCaptureStore();
  store.rows.set("capture_001", row());
  store.rows.set("capture_002", row({
    id: "capture_002",
    content: "Another FLOW thought",
    tags: ["flow", "product"],
    status: "kept",
    createdAt: new Date("2026-08-24T02:00:00.000Z"),
  }));
  store.rows.set("capture_003", row({
    id: "capture_003",
    status: "archived",
    archivedAt: now,
  }));
  const routes = createInspirationRoutes(() => store);
  const handler = route(
    routes,
    "GET",
    "/api/plugins/inspiration/inspirations"
  ).handler;
  const result = await call(handler, {
    query: {
      text: "flow",
      tag: [" Product ", "flow"],
      project: "EchoLog",
      status: ["inbox", "kept"],
      includeArchived: "false",
      createdAfter: "2026-08-24T00:00:00.000Z",
      createdBefore: "2026-08-25T00:00:00.000Z",
      limit: "10",
    },
  });
  assert.deepEqual(result.items.map((item: Inspiration) => item.id), ["capture_002"]);
  assert.deepEqual(store.lastFilter, {
    text: "flow",
    tags: ["flow", "product"],
    project: "EchoLog",
    statuses: ["inbox", "kept"],
    includeArchived: false,
    limit: 10,
    before: new Date("2026-08-25T00:00:00.000Z"),
    after: new Date("2026-08-24T00:00:00.000Z"),
  });
});

test("opaque cursor preserves timestamp and id tie-break boundary", async () => {
  const store = new MemoryCaptureStore();
  const routes = createInspirationRoutes(() => store);
  const cursor = Buffer.from(JSON.stringify({
    createdAt: "2026-08-24T01:00:00.000Z",
    id: "capture_009",
  })).toString("base64url");
  const result = await call(
    route(routes, "GET", "/api/plugins/inspiration/inspirations").handler,
    { query: { cursor, limit: "25" } }
  );
  assert.deepEqual(result, { items: [], nextCursor: null });
  assert.equal(store.lastFilter?.before?.toISOString(), "2026-08-24T01:00:00.000Z");
  assert.equal(store.lastFilter?.beforeId, "capture_009");
  const invalid = await call(
    route(routes, "GET", "/api/plugins/inspiration/inspirations").handler,
    { query: { cursor: "not-a-cursor" } }
  );
  assert.equal(invalid.statusCode, 400);
});

test("version-guarded edits reject stale concurrent updates", async () => {
  const store = new MemoryCaptureStore();
  store.rows.set("capture_001", row());
  const routes = createInspirationRoutes(() => store);
  const handler = route(
    routes,
    "PATCH",
    "/api/plugins/inspiration/inspirations/:id"
  ).handler;
  const first = await call(handler, {
    params: { id: "capture_001" },
    body: { expectedVersion: 1, content: "First writer" },
  });
  assert.equal(first.version, 2);
  const stale = await call(handler, {
    params: { id: "capture_001" },
    body: { expectedVersion: 1, content: "Stale writer" },
  });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.body, {
    error: "Inspiration capture_001 has changed",
    code: "INSPIRATION_VERSION_CONFLICT",
    currentVersion: 2,
  });
  assert.equal(store.rows.get("capture_001")?.content, "First writer");

  const source = readFileSync(
    new URL("../plugins/inspiration/src/store.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /eq\(inspirations\.version, input\.expectedVersion\)/);
  assert.match(source, /eq\(inspirations\.version, expectedVersion\)/);
  assert.match(source, /version: sql`\$\{inspirations\.version\} \+ 1`/);
});

test("archive and restore are explicit versioned lifecycle operations", async () => {
  const store = new MemoryCaptureStore();
  store.rows.set("capture_001", row({ status: "kept" }));
  const routes = createInspirationRoutes(() => store);
  const archived = await call(
    route(
      routes,
      "POST",
      "/api/plugins/inspiration/inspirations/:id/archive"
    ).handler,
    { params: { id: "capture_001" }, body: { expectedVersion: 1 } }
  );
  assert.equal(archived.status, "archived");
  assert.equal(archived.version, 2);
  assert.ok(archived.archivedAt);

  const restored = await call(
    route(
      routes,
      "POST",
      "/api/plugins/inspiration/inspirations/:id/restore"
    ).handler,
    {
      params: { id: "capture_001" },
      body: { expectedVersion: 2, status: "kept" },
    }
  );
  assert.equal(restored.status, "kept");
  assert.equal(restored.version, 3);
  assert.equal(restored.archivedAt, null);
});

test("get, update, archive, and restore return structured missing/state errors", async () => {
  const store = new MemoryCaptureStore();
  store.rows.set("capture_001", row());
  const routes = createInspirationRoutes(() => store);
  const missing = await call(
    route(routes, "GET", "/api/plugins/inspiration/inspirations/:id").handler,
    { params: { id: "missing_001" } }
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.code, "INSPIRATION_NOT_FOUND");

  const invalidRestore = await call(
    route(
      routes,
      "POST",
      "/api/plugins/inspiration/inspirations/:id/restore"
    ).handler,
    { params: { id: "capture_001" }, body: { expectedVersion: 1 } }
  );
  assert.equal(invalidRestore.statusCode, 409);
  assert.equal(invalidRestore.body.code, "INSPIRATION_INVALID_STATE");
  assert.equal(invalidRestore.body.currentVersion, 1);
});

test("store query source implements every Capture filter without cross-plugin access", () => {
  const source = readFileSync(
    new URL("../plugins/inspiration/src/store.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /ILIKE/);
  assert.match(source, /arrayContains\(inspirations\.tags/);
  assert.match(source, /eq\(inspirations\.project/);
  assert.match(source, /inArray\(inspirations\.status/);
  assert.match(source, /ne\(inspirations\.status, "archived"\)/);
  assert.match(source, /orderBy\(desc\(inspirations\.createdAt\), desc\(inspirations\.id\)\)/);
  assert.doesNotMatch(source, /\/api\/(schedule|records)|from\((records|tasks)\)/i);
});
