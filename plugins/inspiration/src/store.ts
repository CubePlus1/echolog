import {
  and,
  arrayContains,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import postgres from "postgres";
import { inspirations } from "./schema.js";
import type {
  CreateInspirationInput,
  Inspiration,
  InspirationListFilter,
  InspirationStatus,
  UpdateInspirationInput,
} from "./types.js";

export type InspirationStoreErrorCode =
  | "INSPIRATION_NOT_FOUND"
  | "INSPIRATION_VERSION_CONFLICT"
  | "INSPIRATION_INVALID_STATE";

export class InspirationStoreError extends Error {
  constructor(
    public readonly code: InspirationStoreErrorCode,
    message: string,
    public readonly statusCode: 404 | 409,
    public readonly currentVersion?: number
  ) {
    super(message);
    this.name = "InspirationStoreError";
  }
}

export interface InspirationStoreListFilter extends InspirationListFilter {
  beforeId?: string;
  after?: Date;
}

export interface InspirationPage {
  items: Inspiration[];
  nextCursor: string | null;
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function encodeCursor(row: Inspiration): string {
  return Buffer.from(JSON.stringify({
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  } satisfies CursorPayload)).toString("base64url");
}

export function decodeInspirationCursor(value: string): {
  before: Date;
  beforeId: string;
} | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      typeof cursor.id !== "string" ||
      cursor.id.length < 1 ||
      cursor.id.length > 64
    ) {
      return null;
    }
    const before = new Date(cursor.createdAt);
    if (!Number.isFinite(before.getTime())) return null;
    return { before, beforeId: cursor.id };
  } catch {
    return null;
  }
}

export class InspirationStore {
  private readonly sql;
  private readonly db;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
    this.db = drizzle(this.sql);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async create(input: CreateInspirationInput): Promise<Inspiration> {
    const now = new Date();
    const [created] = await this.db
      .insert(inspirations)
      .values({
        id: nanoid(12),
        version: 1,
        content: input.content,
        tags: input.tags,
        project: input.project,
        status: input.status,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        lastSurfacedAt: null,
      })
      .returning();
    if (!created) throw new Error("inspiration was not written");
    return created;
  }

  async get(id: string): Promise<Inspiration | null> {
    const [row] = await this.db
      .select()
      .from(inspirations)
      .where(eq(inspirations.id, id));
    return row ?? null;
  }

  async list(filter: InspirationStoreListFilter): Promise<InspirationPage> {
    const conditions: SQL[] = [];
    if (!filter.includeArchived) {
      conditions.push(ne(inspirations.status, "archived"));
    }
    if (filter.statuses?.length) {
      conditions.push(inArray(inspirations.status, filter.statuses));
    }
    if (filter.project !== undefined) {
      conditions.push(eq(inspirations.project, filter.project));
    }
    if (filter.tags?.length) {
      conditions.push(arrayContains(inspirations.tags, filter.tags));
    }
    if (filter.text) {
      conditions.push(
        sql`${inspirations.content} ILIKE ${`%${escapeLike(filter.text)}%`} ESCAPE '\\'`
      );
    }
    if (filter.after) {
      conditions.push(gt(inspirations.createdAt, filter.after));
    }
    if (filter.before) {
      conditions.push(filter.beforeId
        ? or(
            lt(inspirations.createdAt, filter.before),
            and(
              eq(inspirations.createdAt, filter.before),
              lt(inspirations.id, filter.beforeId)
            )
          )!
        : lt(inspirations.createdAt, filter.before));
    }

    const rows = await this.db
      .select()
      .from(inspirations)
      .where(and(...conditions))
      .orderBy(desc(inspirations.createdAt), desc(inspirations.id))
      .limit(filter.limit + 1);
    const hasMore = rows.length > filter.limit;
    const items = hasMore ? rows.slice(0, filter.limit) : rows;
    return {
      items,
      nextCursor: hasMore && items.length
        ? encodeCursor(items[items.length - 1]!)
        : null,
    };
  }

  async update(id: string, input: UpdateInspirationInput): Promise<Inspiration> {
    const changes: {
      content?: string;
      tags?: string[];
      project?: string | null;
      status?: Exclude<InspirationStatus, "archived">;
    } = {};
    if (input.content !== undefined) changes.content = input.content;
    if (input.tags !== undefined) changes.tags = input.tags;
    if (input.project !== undefined) changes.project = input.project;
    if (input.status !== undefined) changes.status = input.status;

    const [updated] = await this.db
      .update(inspirations)
      .set({
        ...changes,
        version: sql`${inspirations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inspirations.id, id),
        eq(inspirations.version, input.expectedVersion),
        ne(inspirations.status, "archived")
      ))
      .returning();
    if (updated) return updated;
    return this.failMutation(id, input.expectedVersion, "update");
  }

  async archive(id: string, expectedVersion: number): Promise<Inspiration> {
    const now = new Date();
    const [updated] = await this.db
      .update(inspirations)
      .set({
        status: "archived",
        archivedAt: now,
        version: sql`${inspirations.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(inspirations.id, id),
        eq(inspirations.version, expectedVersion),
        ne(inspirations.status, "archived")
      ))
      .returning();
    if (updated) return updated;
    return this.failMutation(id, expectedVersion, "archive");
  }

  async restore(
    id: string,
    expectedVersion: number,
    status: Exclude<InspirationStatus, "archived">
  ): Promise<Inspiration> {
    const [updated] = await this.db
      .update(inspirations)
      .set({
        status,
        archivedAt: null,
        version: sql`${inspirations.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(inspirations.id, id),
        eq(inspirations.version, expectedVersion),
        eq(inspirations.status, "archived")
      ))
      .returning();
    if (updated) return updated;
    return this.failMutation(id, expectedVersion, "restore");
  }

  async countCapturedBetween(start: Date, end: Date): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(inspirations)
      .where(and(
        gte(inspirations.createdAt, start),
        lt(inspirations.createdAt, end)
      ));
    return result?.count ?? 0;
  }

  private async failMutation(
    id: string,
    expectedVersion: number,
    operation: "update" | "archive" | "restore"
  ): Promise<never> {
    const current = await this.get(id);
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
    throw new InspirationStoreError(
      "INSPIRATION_INVALID_STATE",
      `Inspiration ${id} cannot be ${operation}d from status ${current.status}`,
      409,
      current.version
    );
  }
}
