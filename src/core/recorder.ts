import { eq, and, inArray, gte, lt, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { records, notes, pauses } from "./schema.js";
import type { Record, Note } from "./schema.js";

type RecordType = "learning" | "project" | "task";
type Source = "cli" | "mcp" | "web" | "api";

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

export async function stopRecord(input: StopInput): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, input.id));
  if (!existing) throw new Error(`Record ${input.id} not found`);
  if (existing.status === "done" || existing.status === "cancelled") {
    throw new Error(`Record ${input.id} already ${existing.status}`);
  }

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
    .where(eq(records.id, input.id))
    .returning();
  return updated;
}

export async function pauseRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new Error(`Record ${id} not found`);
  if (existing.status !== "running") {
    throw new Error(`Record ${id} is ${existing.status}, cannot pause`);
  }

  await db.insert(pauses).values({
    id: nanoid(12),
    recordId: id,
    pausedAt: now,
    resumedAt: null,
    createdAt: now,
  });

  const duration = await computeDuration(existing, now);
  const [updated] = await db
    .update(records)
    .set({ status: "paused", durationSeconds: duration, updatedAt: now })
    .where(eq(records.id, id))
    .returning();
  return updated;
}

export async function resumeRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new Error(`Record ${id} not found`);
  if (existing.status !== "paused") {
    throw new Error(`Record ${id} is ${existing.status}, cannot resume`);
  }

  const openPauses = await db
    .select()
    .from(pauses)
    .where(and(eq(pauses.recordId, id), sql`${pauses.resumedAt} IS NULL`));

  for (const p of openPauses) {
    await db
      .update(pauses)
      .set({ resumedAt: now })
      .where(eq(pauses.id, p.id));
  }

  const [updated] = await db
    .update(records)
    .set({ status: "running", updatedAt: now })
    .where(eq(records.id, id))
    .returning();
  return updated;
}

export async function cancelRecord(id: string): Promise<Record> {
  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select()
    .from(records)
    .where(eq(records.id, id));
  if (!existing) throw new Error(`Record ${id} not found`);
  if (existing.status === "done" || existing.status === "cancelled") {
    throw new Error(`Record ${id} already ${existing.status}`);
  }

  const [updated] = await db
    .update(records)
    .set({ status: "cancelled", endAt: now, updatedAt: now })
    .where(eq(records.id, id))
    .returning();
  return updated;
}

export async function addNote(input: AddNoteInput): Promise<Note> {
  const db = getDb();
  const now = new Date();
  const note = {
    id: nanoid(12),
    recordId: input.recordId,
    content: input.content,
    type: input.type ?? "note",
    createdAt: now,
  };
  const [inserted] = await db.insert(notes).values(note).returning();
  return inserted;
}

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
  const [updated] = await db
    .update(records)
    .set({ ...updates, updatedAt: now })
    .where(eq(records.id, id))
    .returning();
  if (!updated) throw new Error(`Record ${id} not found`);
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

export async function getRecordsByDate(
  date: string
): Promise<Record[]> {
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
  since?: string;
  project?: string;
  type?: string;
  limit?: number;
}): Promise<Record[]> {
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

  const query = db
    .select()
    .from(records)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(records.startAt))
    .limit(filters?.limit ?? 50);
  return query;
}

export async function stopAllActive(): Promise<Record[]> {
  const active = await getActiveRecords();
  const results: Record[] = [];
  for (const r of active) {
    const stopped = await stopRecord({ id: r.id });
    results.push(stopped);
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

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
