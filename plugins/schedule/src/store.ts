import {
  and,
  asc,
  desc,
  eq,
  gte,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import postgres from "postgres";
import {
  scheduleItems,
  scheduleReminderDeliveries,
  type ScheduleItemRow,
  type ScheduleReminderDeliveryRow,
} from "./schema.js";
import type {
  CreateScheduleItemInput,
  EditScheduleItemInput,
  NotificationSendResult,
  ReminderDelivery,
  ScheduleConflictMetadata,
  ScheduleItem,
  ScheduleStatus,
} from "./types.js";

export class ScheduleNotFoundError extends Error {
  constructor(public readonly itemId: string) {
    super(`Schedule item ${itemId} not found`);
    this.name = "ScheduleNotFoundError";
  }
}

export class ScheduleConflictError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly expectedVersion: number,
    public readonly metadata: ScheduleConflictMetadata
  ) {
    super(`Schedule item ${itemId} has changed or cannot perform this action`);
    this.name = "ScheduleConflictError";
  }
}

export interface ScheduleListFilter {
  from?: Date;
  to?: Date;
  statuses?: ScheduleStatus[];
}

export interface DueReminder {
  item: ScheduleItem;
  reminderAt: Date;
}

export const SCHEDULE_CLAIM_TIMEOUT_MS = 5_000;

export class ScheduleClaimTimeoutError extends Error {
  readonly code = "SCHEDULE_CLAIM_TIMEOUT" as const;

  constructor(public readonly timeoutMs: number) {
    super(`Schedule reminder claim timed out after ${timeoutMs}ms`);
    this.name = "ScheduleClaimTimeoutError";
  }
}

export interface ScheduleStoreOptions {
  claimTimeoutMs?: number;
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/**
 * Bound the claim transport without conflating an internal timeout with the
 * caller's AbortSignal.  The operation is deliberately allowed to settle
 * after the race, but its internal signal guards every transaction write so a
 * late lock release cannot insert a claim.
 */
function runBoundedClaim<T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const internalController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let removeCallerListener: (() => void) | undefined;

  const operationPromise = Promise.resolve().then(() =>
    operation(internalController.signal)
  );
  // The operation may settle after the timeout/abort race.  Attach a rejection
  // handler immediately so that a late database error is never unhandled.
  void operationPromise.catch(() => undefined);

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      removeCallerListener?.();
      removeCallerListener = undefined;
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const rejectCallerAbort = () => {
      internalController.abort();
      settle(() => reject(callerAbortReason(callerSignal!)));
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        rejectCallerAbort();
        return;
      }
      const onAbort = () => rejectCallerAbort();
      callerSignal.addEventListener("abort", onAbort, { once: true });
      removeCallerListener = () => callerSignal.removeEventListener("abort", onAbort);
    }

    timer = setTimeout(() => {
      internalController.abort();
      settle(() => reject(new ScheduleClaimTimeoutError(timeoutMs)));
    }, timeoutMs);

    void operationPromise.then(
      (value) => {
        if (callerSignal?.aborted) {
          rejectCallerAbort();
          return;
        }
        settle(() => resolve(value));
      },
      (error: unknown) => {
        if (callerSignal?.aborted) {
          rejectCallerAbort();
          return;
        }
        settle(() => reject(error));
      }
    );
  });
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function scheduleItemFromRow(
  row: ScheduleItemRow,
  now = new Date()
): ScheduleItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduledStartAt: row.scheduledStartAt.toISOString(),
    scheduledEndAt: iso(row.scheduledEndAt),
    timezone: row.timezone,
    priority: row.priority,
    status: row.status,
    nextReminderAt: iso(row.nextReminderAt),
    confirmedStartAt: iso(row.confirmedStartAt),
    completedAt: iso(row.completedAt),
    cancelledAt: iso(row.cancelledAt),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    awaitingConfirmation:
      row.status === "scheduled" && row.scheduledStartAt.getTime() <= now.getTime(),
  };
}

function reminderFromRow(row: ScheduleReminderDeliveryRow): ReminderDelivery {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    itemId: row.itemId,
    reminderAt: row.reminderAt.toISOString(),
    attemptedAt: row.attemptedAt.toISOString(),
    completedAt: iso(row.completedAt),
    status: row.status,
    channelResults: row.channelResults,
    failure: row.failure,
  };
}

export function reminderDedupeKey(itemId: string, reminderAt: Date): string {
  return `schedule:${itemId}:${reminderAt.toISOString()}`;
}

export class ScheduleStore {
  private readonly sql;
  private readonly db;
  private closed = false;
  private readonly claimTimeoutMs: number;

  constructor(databaseUrl: string, options: ScheduleStoreOptions = {}) {
    const claimTimeoutMs = options.claimTimeoutMs ?? SCHEDULE_CLAIM_TIMEOUT_MS;
    if (!Number.isInteger(claimTimeoutMs) || claimTimeoutMs <= 0) {
      throw new Error("claimTimeoutMs must be a positive integer");
    }
    this.sql = postgres(databaseUrl);
    this.db = drizzle(this.sql);
    this.claimTimeoutMs = claimTimeoutMs;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.sql.end();
  }

  async create(input: CreateScheduleItemInput, now = new Date()): Promise<ScheduleItem> {
    const [created] = await this.db
      .insert(scheduleItems)
      .values({
        id: nanoid(12),
        ...input,
        status: "scheduled",
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("schedule item was not written");
    return scheduleItemFromRow(created, now);
  }

  async get(id: string, now = new Date()): Promise<ScheduleItem | null> {
    const row = await this.getRow(id);
    return row ? scheduleItemFromRow(row, now) : null;
  }

  private async getRow(id: string): Promise<ScheduleItemRow | null> {
    const [row] = await this.db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, id));
    return row ?? null;
  }

  async list(filter: ScheduleListFilter = {}, now = new Date()): Promise<ScheduleItem[]> {
    const predicates: SQL[] = [];
    if (filter.to) predicates.push(lt(scheduleItems.scheduledStartAt, filter.to));
    if (filter.from) {
      predicates.push(or(
        gt(scheduleItems.scheduledEndAt, filter.from),
        and(
          isNull(scheduleItems.scheduledEndAt),
          gte(scheduleItems.scheduledStartAt, filter.from)
        )
      )!);
    }
    if (filter.statuses?.length) {
      predicates.push(inArray(scheduleItems.status, filter.statuses));
    }
    const rows = await this.db
      .select()
      .from(scheduleItems)
      .where(predicates.length ? and(...predicates) : undefined)
      .orderBy(asc(scheduleItems.scheduledStartAt), desc(scheduleItems.priority));
    return rows.map((row) => scheduleItemFromRow(row, now));
  }

  async edit(
    id: string,
    expectedVersion: number,
    changes: EditScheduleItemInput,
    now = new Date()
  ): Promise<ScheduleItem> {
    const explicitlyEditsReminder = Object.hasOwn(changes, "nextReminderAt");
    const nextReminderAt = explicitlyEditsReminder
      ? changes.nextReminderAt
      : changes.scheduledStartAt
        ? sql`CASE
            WHEN ${scheduleItems.nextReminderAt} = ${scheduleItems.scheduledStartAt}
              THEN ${changes.scheduledStartAt.toISOString()}::timestamptz
            ELSE ${scheduleItems.nextReminderAt}
          END`
        : undefined;
    const [updated] = await this.db
      .update(scheduleItems)
      .set({
        ...changes,
        ...(nextReminderAt === undefined ? {} : { nextReminderAt }),
        version: sql`${scheduleItems.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(scheduleItems.id, id),
        eq(scheduleItems.version, expectedVersion),
        eq(scheduleItems.status, "scheduled")
      ))
      .returning();
    if (!updated) await this.throwMutationFailure(id, expectedVersion);
    return scheduleItemFromRow(updated!, now);
  }

  async confirmStart(
    id: string,
    expectedVersion: number,
    now = new Date()
  ): Promise<ScheduleItem> {
    return this.transition(
      id,
      expectedVersion,
      ["scheduled"],
      {
        status: "active",
        confirmedStartAt: now,
        nextReminderAt: null,
      },
      now
    );
  }

  async snooze(
    id: string,
    expectedVersion: number,
    nextReminderAt: Date,
    now = new Date()
  ): Promise<ScheduleItem> {
    return this.transition(
      id,
      expectedVersion,
      ["scheduled"],
      { nextReminderAt },
      now
    );
  }

  async complete(
    id: string,
    expectedVersion: number,
    now = new Date()
  ): Promise<ScheduleItem> {
    return this.transition(
      id,
      expectedVersion,
      ["scheduled", "active"],
      { status: "done", completedAt: now, nextReminderAt: null },
      now
    );
  }

  async cancel(
    id: string,
    expectedVersion: number,
    now = new Date()
  ): Promise<ScheduleItem> {
    return this.transition(
      id,
      expectedVersion,
      ["scheduled", "active"],
      { status: "cancelled", cancelledAt: now, nextReminderAt: null },
      now
    );
  }

  private async transition(
    id: string,
    expectedVersion: number,
    statuses: ScheduleStatus[],
    changes: Partial<typeof scheduleItems.$inferInsert>,
    now: Date
  ): Promise<ScheduleItem> {
    const [updated] = await this.db
      .update(scheduleItems)
      .set({
        ...changes,
        version: sql`${scheduleItems.version} + 1`,
        updatedAt: now,
      })
      .where(and(
        eq(scheduleItems.id, id),
        eq(scheduleItems.version, expectedVersion),
        inArray(scheduleItems.status, statuses)
      ))
      .returning();
    if (!updated) await this.throwMutationFailure(id, expectedVersion);
    return scheduleItemFromRow(updated!, now);
  }

  private async throwMutationFailure(
    id: string,
    expectedVersion: number
  ): Promise<never> {
    const current = await this.getRow(id);
    if (!current) throw new ScheduleNotFoundError(id);
    throw new ScheduleConflictError(id, expectedVersion, {
      currentVersion: current.version,
      currentStatus: current.status,
    });
  }

  async dueReminders(now = new Date(), limit = 100): Promise<DueReminder[]> {
    const rows = await this.db
      .select()
      .from(scheduleItems)
      .where(and(
        eq(scheduleItems.status, "scheduled"),
        isNotNull(scheduleItems.nextReminderAt),
        lte(scheduleItems.nextReminderAt, now),
        notExists(
          this.db
            .select({ id: scheduleReminderDeliveries.id })
            .from(scheduleReminderDeliveries)
            .where(and(
              eq(scheduleReminderDeliveries.itemId, scheduleItems.id),
              eq(
                scheduleReminderDeliveries.reminderAt,
                scheduleItems.nextReminderAt
              )
            ))
        )
      ))
      .orderBy(asc(scheduleItems.nextReminderAt), asc(scheduleItems.id))
      .limit(limit);
    return rows.map((row) => ({
      item: scheduleItemFromRow(row, now),
      reminderAt: row.nextReminderAt!,
    }));
  }

  async claimReminder(
    itemId: string,
    reminderAt: Date,
    attemptedAt = new Date(),
    callerSignal?: AbortSignal
  ): Promise<ReminderDelivery | null> {
    const id = nanoid(12);
    const dedupeKey = reminderDedupeKey(itemId, reminderAt);
    const reminderInstant = reminderAt.toISOString();
    const attemptedInstant = attemptedAt.toISOString();
    const inserted = await runBoundedClaim(
      callerSignal,
      this.claimTimeoutMs,
      async (internalSignal) => this.sql.begin(async (transaction) => {
        internalSignal.throwIfAborted();
        // Lock and re-check the item so a stale due-list snapshot cannot claim
        // a reminder that was already confirmed, cancelled, or snoozed.
        const eligible = await transaction<{ id: string }[]>`
          SELECT id
          FROM schedule_items
          WHERE id = ${itemId}
            AND status = 'scheduled'
            AND next_reminder_at = ${reminderInstant}
          FOR UPDATE
        `;
        internalSignal.throwIfAborted();
        if (!eligible[0]) return false;
        internalSignal.throwIfAborted();
        const claimed = await transaction<{ id: string }[]>`
          INSERT INTO schedule_reminder_deliveries (
            id, dedupe_key, item_id, reminder_at, attempted_at, status
          ) VALUES (
            ${id}, ${dedupeKey}, ${itemId}, ${reminderInstant}, ${attemptedInstant}, 'claimed'
          )
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `;
        internalSignal.throwIfAborted();
        return Boolean(claimed[0]);
      })
    );
    if (callerSignal) callerSignal.throwIfAborted();
    return inserted ? {
      id,
      dedupeKey,
      itemId,
      reminderAt: reminderAt.toISOString(),
      attemptedAt: attemptedAt.toISOString(),
      completedAt: null,
      status: "claimed",
      channelResults: null,
      failure: null,
    } : null;
  }

  async finishReminder(
    id: string,
    input: {
      status: "sent" | "failed";
      channelResults: NotificationSendResult["channels"] | null;
      failure: string | null;
    },
    completedAt = new Date(),
    callerSignal?: AbortSignal
  ): Promise<ReminderDelivery> {
    callerSignal?.throwIfAborted();
    const updated = await this.db.transaction(async (transaction) => {
      callerSignal?.throwIfAborted();
      const [claimable] = await transaction
        .select({ id: scheduleReminderDeliveries.id })
        .from(scheduleReminderDeliveries)
        .where(and(
          eq(scheduleReminderDeliveries.id, id),
          eq(scheduleReminderDeliveries.status, "claimed")
        ))
        .for("update");
      // The row lock is the blocking wait in this transaction. Recheck after
      // it returns and again immediately before the terminal state mutation.
      callerSignal?.throwIfAborted();
      if (!claimable) throw new Error(`Reminder delivery ${id} is not claimable`);
      callerSignal?.throwIfAborted();
      const [row] = await transaction
        .update(scheduleReminderDeliveries)
        .set({
          ...input,
          failure: input.failure?.slice(0, 1_000) ?? null,
          completedAt,
        })
        .where(and(
          eq(scheduleReminderDeliveries.id, id),
          eq(scheduleReminderDeliveries.status, "claimed")
        ))
        .returning();
      // Keep the final post-write fence inside the transaction so an abort
      // observed here rolls the terminal mutation back before commit.
      callerSignal?.throwIfAborted();
      if (!row) throw new Error(`Reminder delivery ${id} is not claimable`);
      return row;
    });
    callerSignal?.throwIfAborted();
    return reminderFromRow(updated);
  }

  async listReminders(
    filter: { itemId?: string; limit: number }
  ): Promise<ReminderDelivery[]> {
    const rows = await this.db
      .select()
      .from(scheduleReminderDeliveries)
      .where(filter.itemId
        ? eq(scheduleReminderDeliveries.itemId, filter.itemId)
        : undefined)
      .orderBy(desc(scheduleReminderDeliveries.attemptedAt))
      .limit(filter.limit);
    return rows.map(reminderFromRow);
  }
}
