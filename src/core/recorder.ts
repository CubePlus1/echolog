import { eq, and, inArray, gte, lt, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { records, notes, pauses } from "./schema.js";
import type { Record, Note } from "./schema.js";
import { localDateStr } from "./utils.js";

type RecordType = "learning" | "project" | "task";
type Source = "cli" | "mcp" | "web" | "api";

export class RecordNotFoundError extends Error {
  constructor(id: string) {
    super(`Record ${id} not found`);
    this.name = "RecordNotFoundError";
  }
}

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

interface StartInput {
  title: string;
  type?: RecordType;
  tags?: string[];
  project?: string;
  source?: Source;
}

interface StopInput {
  id: string;
  result?: string;
}

interface AddNoteInput {
  recordId: string;
  content: string;
  type?: "note" | "blocker" | "next";
}

interface BackfillInput {
  title: string;
  type?: RecordType;
  tags?: string[];
  project?: string;
  startAt: Date;
  durationMinutes: number;
  result?: string;
  source?: Source;
}

export async function startRecord(input: StartInput): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const record = {
    id: nanoid(12),
    title: input.title,
    type: input.type ?? "task",
    tags: input.tags ?? [],
    project: input.project ?? null,
    startAt: now,
    endAt: null,
    status: "running" as const,
    durationSeconds: 0,
    result: null,
    source: input.source ?? "cli",
    createdAt: now,
    updatedAt: now,
  };
  const [inserted] = await db.insert(records).values(record).returning();
  return inserted;
}

// C-1 fix: use atomic WHERE clause for state transitions instead of read-then-write
export async function stopRecord(input: StopInput): Promise<Record> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, input.id));
  if (!existing) throw new RecordNotFoundError(input.id);

  const duration = await computeDuration(existing, now);

  const [updated] = await db
    .update(records)
    .set({
      status: "done",
      endAt: now,
      durationSeconds: duration,
      result: input.result ?? existing.result,
      updatedAt: now,
    })
    .where(
      and(
        eq(records.id, input.id),
        inArray(records.status, ["running", "paused"])
      )
    )
    .returning();

  if (!updated) {
    throw new InvalidStateError(
      `Record ${input.id} is already ${existing.status}`
    );
  }
  return updated;
}

export async function pauseRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new RecordNotFoundError(id);

  const duration = await computeDuration(existing, now);

  // Atomic: only update if still running
  const [updated] = await db
    .update(records)
    .set({ status: "paused", durationSeconds: duration, updatedAt: now })
    .where(and(eq(records.id, id), eq(records.status, "running")))
    .returning();

  if (!updated) {
    throw new InvalidStateError(
      `Record ${id} is ${existing.status}, cannot pause`
    );
  }

  await db.insert(pauses).values({
    id: nanoid(12),
    recordId: id,
    pausedAt: now,
    resumedAt: null,
    createdAt: now,
  });

  return updated;
}

export async function resumeRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new RecordNotFoundError(id);

  // Atomic: only update if paused
  const [updated] = await db
    .update(records)
    .set({ status: "running", updatedAt: now })
    .where(and(eq(records.id, id), eq(records.status, "paused")))
    .returning();

  if (!updated) {
    throw new InvalidStateError(
      `Record ${id} is ${existing.status}, cannot resume`
    );
  }

  await db
    .update(pauses)
    .set({ resumedAt: now })
    .where(
      and(eq(pauses.recordId, id), sql`${pauses.resumedAt} IS NULL`)
    );

  return updated;
}

export async function cancelRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new RecordNotFoundError(id);

  const [updated] = await db
    .update(records)
    .set({ status: "cancelled", endAt: now, updatedAt: now })
    .where(
      and(
        eq(records.id, id),
        inArray(records.status, ["running", "paused"])
      )
    )
    .returning();

  if (!updated) {
    throw new InvalidStateError(
      `Record ${id} already ${existing.status}`
    );
  }
  return updated;
}

// H-5 fix: verify record exists before adding note
export async function addNote(input: AddNoteInput): Promise<Note> {
  const db = getDb();
  const [record] = await db
    .select({ id: records.id })
    .from(records)
    .where(eq(records.id, input.recordId));
  if (!record) throw new RecordNotFoundError(input.recordId);

  const now = new Date();
  const [inserted] = await db
    .insert(notes)
    .values({
      id: nanoid(12),
      recordId: input.recordId,
      content: input.content,
      type: input.type ?? "note",
      createdAt: now,
    })
    .returning();
  return inserted;
}

// H-6 fix: whitelist allowed fields explicitly
export async function editRecord(
  id: string,
  updates: {
    title?: string;
    type?: RecordType;
    tags?: string[];
    project?: string;
    result?: string;
  }
): Promise<Record> {
  const db = getDb();
  const now = new Date();

  const safeUpdates: Partial<typeof records.$inferInsert> = { updatedAt: now };
  if (updates.title !== undefined) safeUpdates.title = updates.title;
  if (updates.type !== undefined) safeUpdates.type = updates.type;
  if (updates.tags !== undefined) safeUpdates.tags = updates.tags;
  if (updates.project !== undefined) safeUpdates.project = updates.project;
  if (updates.result !== undefined) safeUpdates.result = updates.result;

  const [updated] = await db
    .update(records)
    .set(safeUpdates)
    .where(eq(records.id, id))
    .returning();
  if (!updated) throw new RecordNotFoundError(id);
  return updated;
}

export async function backfillRecord(input: BackfillInput): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const endAt = new Date(
    input.startAt.getTime() + input.durationMinutes * 60_000
  );
  const record = {
    id: nanoid(12),
    title: input.title,
    type: input.type ?? "task",
    tags: input.tags ?? [],
    project: input.project ?? null,
    startAt: input.startAt,
    endAt,
    status: "done" as const,
    durationSeconds: input.durationMinutes * 60,
    result: input.result ?? null,
    source: input.source ?? "cli",
    createdAt: now,
    updatedAt: now,
  };
  const [inserted] = await db.insert(records).values(record).returning();
  return inserted;
}

export async function getActiveRecords(): Promise<Record[]> {
  const db = getDb();
  return db
    .select()
    .from(records)
    .where(inArray(records.status, ["running", "paused"]))
    .orderBy(desc(records.startAt));
}

export interface EnrichedRecord extends Record {
  lastResumedAt: Date | null;
  liveDurationSeconds: number;
}

export async function getActiveRecordsEnriched(): Promise<EnrichedRecord[]> {
  const db = getDb();
  const active = await getActiveRecords();
  const now = new Date();
  const enriched: EnrichedRecord[] = [];

  for (const r of active) {
    const recordPauses = await db
      .select()
      .from(pauses)
      .where(eq(pauses.recordId, r.id))
      .orderBy(desc(pauses.pausedAt));

    let lastResumedAt: Date | null = null;
    if (r.status === "running" && recordPauses.length > 0) {
      const lastPause = recordPauses.find((p) => p.resumedAt !== null);
      if (lastPause) lastResumedAt = lastPause.resumedAt;
    }

    const liveDuration = await computeDuration(r, now);

    enriched.push({
      ...r,
      lastResumedAt: lastResumedAt ?? (r.status === "running" ? r.startAt : null),
      liveDurationSeconds: liveDuration,
    });
  }
  return enriched;
}

export async function getRecord(id: string): Promise<Record | undefined> {
  const db = getDb();
  const [record] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  return record;
}

export async function getRecordNotes(recordId: string): Promise<Note[]> {
  const db = getDb();
  return db
    .select()
    .from(notes)
    .where(eq(notes.recordId, recordId))
    .orderBy(notes.createdAt);
}

export async function getRecordsByDate(date: string): Promise<Record[]> {
  const db = getDb();
  const dayStart = new Date(`${date}T00:00:00.000`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(records)
    .where(and(gte(records.startAt, dayStart), lt(records.startAt, dayEnd)))
    .orderBy(records.startAt);
}

export async function getRecords(filters?: {
  date?: string;
  since?: string;
  project?: string;
  type?: string;
  limit?: number;
}): Promise<Record[]> {
  if (filters?.date) {
    return getRecordsByDate(filters.date);
  }
  const db = getDb();
  const conditions = [];
  if (filters?.since) {
    conditions.push(gte(records.startAt, new Date(filters.since)));
  }
  if (filters?.project) {
    conditions.push(eq(records.project, filters.project));
  }
  if (filters?.type) {
    conditions.push(eq(records.type, filters.type));
  }

  return db
    .select()
    .from(records)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(records.startAt))
    .limit(filters?.limit ?? 50);
}

export async function stopAllActive(): Promise<Record[]> {
  const active = await getActiveRecords();
  const results: Record[] = [];
  for (const r of active) {
    try {
      const stopped = await stopRecord({ id: r.id });
      results.push(stopped);
    } catch {
      // already stopped by concurrent request, skip
    }
  }
  return results;
}

async function computeDuration(record: Record, until: Date): Promise<number> {
  const db = getDb();
  const recordPauses = await db
    .select()
    .from(pauses)
    .where(eq(pauses.recordId, record.id));

  let pausedMs = 0;
  for (const p of recordPauses) {
    const end = p.resumedAt ?? until;
    pausedMs += end.getTime() - p.pausedAt.getTime();
  }

  const totalMs = until.getTime() - record.startAt.getTime();
  return Math.max(0, Math.round((totalMs - pausedMs) / 1000));
}

export interface TodaySummary {
  totalSeconds: number;
  recordCount: number;
  byType: { learning: number; project: number; task: number };
  active: Record[];
}

export async function getTodaySummary(): Promise<TodaySummary> {
  const today = localDateStr();
  const todayRecords = await getRecordsByDate(today);
  const active = await getActiveRecords();

  const now = new Date();
  let totalSeconds = 0;
  const byType = { learning: 0, project: 0, task: 0 };

  for (const r of todayRecords) {
    let dur = r.durationSeconds;
    if (r.status === "running") {
      dur = await computeDuration(r, now);
    }
    totalSeconds += dur;
    if (r.type in byType) {
      byType[r.type as keyof typeof byType] += dur;
    }
  }

  return {
    totalSeconds,
    recordCount: todayRecords.filter((r) => r.status !== "cancelled").length,
    byType,
    active,
  };
}
