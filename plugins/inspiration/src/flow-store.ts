import { nanoid } from "nanoid";
import postgres from "postgres";
import {
  isQuietMinute,
  minuteOfLocalDay,
  selectFlowCandidate,
} from "./selector.js";
import type {
  DailyInspirationSummary,
  FlowCandidate,
  FlowDelivery,
  FlowOutcome,
  FlowSettings,
  FlowSettingsUpdate,
  FlowSource,
  Inspiration,
  InspirationStatus,
} from "./types.js";

type SettingsRow = {
  id: "default";
  version: number;
  enabled: boolean;
  interval_minutes: number;
  quiet_start_minute: number;
  quiet_end_minute: number;
  cooldown_minutes: number;
  daily_limit: number;
  default_snooze_minutes: number;
  statuses: string[];
  tags: string[];
  projects: string[];
  updated_at: Date | string;
};

type InspirationRow = {
  id: string;
  version: number;
  content: string;
  tags: string[];
  project: string | null;
  status: InspirationStatus;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  last_surfaced_at: Date | string | null;
};

type DeliveryRow = {
  id: string;
  version: number;
  attempts: number;
  inspiration_id: string;
  source: FlowSource;
  dedupe_key: string;
  status: FlowDelivery["status"];
  outcome: FlowOutcome | null;
  surfaced_at: Date | string;
  notified_at: Date | string | null;
  snoozed_until: Date | string | null;
  outcome_at: Date | string | null;
  notification_channel: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type FlowStoreErrorCode =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_STATE";

export class FlowStoreError extends Error {
  constructor(
    public readonly code: FlowStoreErrorCode,
    message: string,
    public readonly statusCode: 404 | 409,
    public readonly currentDeliveryVersion?: number,
    public readonly currentInspirationVersion?: number
  ) {
    super(message);
    this.name = "FlowStoreError";
  }
}

export interface FlowReserveResult {
  candidate: FlowCandidate | null;
  explanation: string[];
  shouldNotify: boolean;
}

export interface FlowOutcomeResult {
  delivery: FlowDelivery;
  inspiration: Inspiration;
}

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : date(value);
}

function mapSettings(row: SettingsRow): FlowSettings {
  return {
    id: "default",
    version: row.version,
    enabled: row.enabled,
    intervalMinutes: row.interval_minutes,
    quietStartMinute: row.quiet_start_minute,
    quietEndMinute: row.quiet_end_minute,
    cooldownMinutes: row.cooldown_minutes,
    dailyLimit: row.daily_limit,
    defaultSnoozeMinutes: row.default_snooze_minutes,
    statuses: row.statuses as FlowSettings["statuses"],
    tags: row.tags,
    projects: row.projects,
    updatedAt: date(row.updated_at),
  };
}

function mapInspiration(row: InspirationRow): Inspiration {
  return {
    id: row.id,
    version: row.version,
    content: row.content,
    tags: row.tags,
    project: row.project,
    status: row.status,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    archivedAt: nullableDate(row.archived_at),
    lastSurfacedAt: nullableDate(row.last_surfaced_at),
  };
}

function mapDelivery(row: DeliveryRow): FlowDelivery {
  return {
    id: row.id,
    version: row.version,
    attempts: row.attempts,
    inspirationId: row.inspiration_id,
    source: row.source,
    dedupeKey: row.dedupe_key,
    status: row.status,
    outcome: row.outcome,
    surfacedAt: date(row.surfaced_at),
    notifiedAt: nullableDate(row.notified_at),
    snoozedUntil: nullableDate(row.snoozed_until),
    outcomeAt: nullableDate(row.outcome_at),
    notificationChannel: row.notification_channel,
    error: row.error,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

export const FLOW_RESERVATION_LEASE_MS = 30_000;

function startOfLocalDay(value: Date): Date {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    0,
    0,
    0,
    0
  );
}

function dateBounds(localDate: string): { start: Date; end: Date } {
  const [year, month, day] = localDate.split("-").map(Number);
  const start = new Date(year!, month! - 1, day!, 0, 0, 0, 0);
  const end = new Date(year!, month! - 1, day! + 1, 0, 0, 0, 0);
  return { start, end };
}

export class FlowStore {
  private readonly sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async getSettings(): Promise<FlowSettings> {
    const rows = await this.sql<SettingsRow[]>`
      SELECT * FROM inspiration_flow_settings WHERE id = 'default'
    `;
    const row = rows[0];
    if (!row) throw new Error("inspiration Flow settings are unavailable");
    return mapSettings(row);
  }

  async updateSettings(input: FlowSettingsUpdate): Promise<FlowSettings | null> {
    const rows = await this.sql<SettingsRow[]>`
      UPDATE inspiration_flow_settings
      SET enabled = ${input.enabled},
          interval_minutes = ${input.intervalMinutes},
          quiet_start_minute = ${input.quietStartMinute},
          quiet_end_minute = ${input.quietEndMinute},
          cooldown_minutes = ${input.cooldownMinutes},
          daily_limit = ${input.dailyLimit},
          default_snooze_minutes = ${input.defaultSnoozeMinutes},
          statuses = ${input.statuses},
          tags = ${input.tags},
          projects = ${input.projects},
          version = version + 1,
          updated_at = NOW()
      WHERE id = 'default' AND version = ${input.expectedVersion}
      RETURNING *
    `;
    return rows[0] ? mapSettings(rows[0]) : null;
  }

  async reserveNext(
    source: FlowSource,
    dedupeKey: string,
    now = new Date(),
    signal?: AbortSignal
  ): Promise<FlowReserveResult> {
    signal?.throwIfAborted();
    return this.sql.begin(async (transaction) => {
      // The advisory lock turns a concurrent unique-key race into a normal
      // idempotent lookup, without leaving the losing transaction aborted.
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))
      `;
      signal?.throwIfAborted();

      const duplicateRows = await transaction<DeliveryRow[]>`
        SELECT * FROM inspiration_flow_deliveries WHERE dedupe_key = ${dedupeKey}
      `;
      signal?.throwIfAborted();

      const resultForDelivery = async (
        delivery: DeliveryRow,
        explanation: string[],
        shouldNotify: boolean
      ): Promise<FlowReserveResult> => {
        const inspirationRows = await transaction<InspirationRow[]>`
          SELECT * FROM inspirations
          WHERE id = ${delivery.inspiration_id}
        `;
        signal?.throwIfAborted();
        const inspiration = inspirationRows[0];
        if (!inspiration) {
          throw new Error("Flow delivery references a missing inspiration");
        }
        return {
          candidate: {
            inspiration: mapInspiration(inspiration),
            delivery: mapDelivery(delivery),
            explanation,
            duplicate: true,
          },
          explanation,
          shouldNotify,
        };
      };

      const duplicate = duplicateRows[0];
      if (duplicate && duplicate.status !== "reserved") {
        return resultForDelivery(
          duplicate,
          ["dedupe:existing-delivery"],
          false
        );
      }

      const settingsRows = await transaction<SettingsRow[]>`
        SELECT * FROM inspiration_flow_settings WHERE id = 'default' FOR UPDATE
      `;
      signal?.throwIfAborted();
      const settingsRow = settingsRows[0];
      if (!settingsRow) throw new Error("inspiration Flow settings are unavailable");
      const settings = mapSettings(settingsRow);

      let pending = duplicate;
      if (!pending && source === "scheduled") {
        const pendingRows = await transaction<DeliveryRow[]>`
          SELECT * FROM inspiration_flow_deliveries
          WHERE source = 'scheduled' AND status = 'reserved'
          ORDER BY created_at, id
          LIMIT 1
          FOR UPDATE
        `;
        signal?.throwIfAborted();
        pending = pendingRows[0];
      }

      if (pending) {
        if (source === "scheduled") {
          const gateReasons = [
            ...(!settings.enabled ? ["policy:disabled"] : []),
            ...(isQuietMinute(
              minuteOfLocalDay(now),
              settings.quietStartMinute,
              settings.quietEndMinute
            ) ? ["policy:quiet-hours"] : []),
          ];
          if (gateReasons.length > 0) {
            return resultForDelivery(pending, gateReasons, false);
          }
        }

        const retryCutoff = new Date(now.getTime() - FLOW_RESERVATION_LEASE_MS);
        if (date(pending.updated_at).getTime() > retryCutoff.getTime()) {
          return resultForDelivery(
            pending,
            ["dedupe:delivery-in-flight"],
            false
          );
        }

        signal?.throwIfAborted();
        const claimedRows = await transaction<DeliveryRow[]>`
          UPDATE inspiration_flow_deliveries
          SET attempts = attempts + 1,
              version = version + 1,
              updated_at = ${now}
          WHERE id = ${pending.id}
            AND version = ${pending.version}
            AND status = 'reserved'
          RETURNING *
        `;
        signal?.throwIfAborted();
        const claimed = claimedRows[0];
        if (!claimed) {
          throw new FlowStoreError(
            "VERSION_CONFLICT",
            `delivery ${pending.id} changed during recovery`,
            409,
            pending.version
          );
        }
        return resultForDelivery(
          claimed,
          ["recovery:pending-delivery"],
          true
        );
      }

      // Lock the complete local candidate set. This personal-data plugin is
      // intentionally small, and the lock makes independent manual/scheduled
      // reservations share one serial, deterministic selector snapshot.
      const inspirationRows = await transaction<InspirationRow[]>`
        SELECT * FROM inspirations
        ORDER BY last_surfaced_at NULLS FIRST, created_at, id
        FOR UPDATE
      `;
      signal?.throwIfAborted();
      const snoozeRows = await transaction<{
        inspiration_id: string;
        snoozed_until: Date | string | null;
      }[]>`
        SELECT inspiration_id, MAX(snoozed_until) AS snoozed_until
        FROM inspiration_flow_deliveries
        WHERE snoozed_until IS NOT NULL
        GROUP BY inspiration_id
      `;
      signal?.throwIfAborted();
      const snoozes = new Map(
        snoozeRows.map((row) => [
          row.inspiration_id,
          nullableDate(row.snoozed_until),
        ])
      );
      const dayStart = startOfLocalDay(now);
      const dailyRows = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM inspiration_flow_deliveries
        WHERE surfaced_at >= ${dayStart} AND surfaced_at < ${new Date(
          dayStart.getFullYear(),
          dayStart.getMonth(),
          dayStart.getDate() + 1
        )}
      `;
      signal?.throwIfAborted();

      const selection = selectFlowCandidate({
        candidates: inspirationRows.map((row) => ({
          inspiration: mapInspiration(row),
          snoozedUntil: snoozes.get(row.id) ?? null,
        })),
        settings,
        source,
        now,
        surfacedToday: dailyRows[0]?.count ?? 0,
      });
      if (!selection.selected) {
        return {
          candidate: null,
          explanation: selection.explanation,
          shouldNotify: false,
        };
      }

      const current = selection.selected.inspiration;
      signal?.throwIfAborted();
      const updatedRows = await transaction<InspirationRow[]>`
        UPDATE inspirations
        SET last_surfaced_at = ${now},
            version = version + 1,
            updated_at = ${now}
        WHERE id = ${current.id} AND version = ${current.version}
        RETURNING *
      `;
      signal?.throwIfAborted();
      const updated = updatedRows[0];
      if (!updated) {
        throw new FlowStoreError(
          "VERSION_CONFLICT",
          "inspiration version changed during Flow reservation",
          409,
          undefined,
          current.version
        );
      }

      const deliveryRows = await transaction<DeliveryRow[]>`
        INSERT INTO inspiration_flow_deliveries (
          id, inspiration_id, source, dedupe_key, status, surfaced_at,
          created_at, updated_at
        ) VALUES (
          ${nanoid(12)}, ${current.id}, ${source}, ${dedupeKey}, 'reserved',
          ${now}, ${now}, ${now}
        )
        RETURNING *
      `;
      signal?.throwIfAborted();
      const delivery = deliveryRows[0];
      if (!delivery) throw new Error("Flow delivery reservation failed");
      return {
        candidate: {
          inspiration: mapInspiration(updated),
          delivery: mapDelivery(delivery),
          explanation: selection.explanation,
          duplicate: false,
        },
        explanation: selection.explanation,
        shouldNotify: true,
      };
    });
  }

  async finalizeNotification(
    deliveryId: string,
    expectedVersion: number,
    result:
      | { delivered: true; channel: string | null; at: Date }
      | { delivered: false; error: string; at: Date }
  ): Promise<FlowDelivery> {
    const rows = result.delivered
      ? await this.sql<DeliveryRow[]>`
          UPDATE inspiration_flow_deliveries
          SET status = 'sent', notified_at = ${result.at},
              notification_channel = ${result.channel}, error = NULL,
              version = version + 1, updated_at = ${result.at}
          WHERE id = ${deliveryId} AND version = ${expectedVersion}
            AND status = 'reserved'
          RETURNING *
        `
      : await this.sql<DeliveryRow[]>`
          UPDATE inspiration_flow_deliveries
          SET status = 'failed', error = ${result.error},
              version = version + 1, updated_at = ${result.at}
          WHERE id = ${deliveryId} AND version = ${expectedVersion}
            AND status = 'reserved'
          RETURNING *
        `;
    if (rows[0]) return mapDelivery(rows[0]);

    const currentRows = await this.sql<DeliveryRow[]>`
      SELECT * FROM inspiration_flow_deliveries WHERE id = ${deliveryId}
    `;
    const current = currentRows[0];
    if (!current) {
      throw new FlowStoreError("NOT_FOUND", `delivery ${deliveryId} not found`, 404);
    }
    throw new FlowStoreError(
      "VERSION_CONFLICT",
      `delivery ${deliveryId} changed before notification finalization`,
      409,
      current.version
    );
  }

  async listDeliveries(
    limit = 50,
    before?: Date
  ): Promise<FlowDelivery[]> {
    const rows = before
      ? await this.sql<DeliveryRow[]>`
          SELECT * FROM inspiration_flow_deliveries
          WHERE surfaced_at < ${before}
          ORDER BY surfaced_at DESC, id DESC
          LIMIT ${limit}
        `
      : await this.sql<DeliveryRow[]>`
          SELECT * FROM inspiration_flow_deliveries
          ORDER BY surfaced_at DESC, id DESC
          LIMIT ${limit}
        `;
    return rows.map(mapDelivery);
  }

  async applyOutcome(
    deliveryId: string,
    expectedDeliveryVersion: number,
    expectedInspirationVersion: number,
    outcome: FlowOutcome,
    snoozedUntil: Date | null,
    now = new Date()
  ): Promise<FlowOutcomeResult> {
    return this.sql.begin(async (transaction) => {
      const deliveryRows = await transaction<DeliveryRow[]>`
        SELECT * FROM inspiration_flow_deliveries
        WHERE id = ${deliveryId}
        FOR UPDATE
      `;
      const delivery = deliveryRows[0];
      if (!delivery) {
        throw new FlowStoreError(
          "NOT_FOUND",
          `delivery ${deliveryId} not found`,
          404
        );
      }
      const inspirationRows = await transaction<InspirationRow[]>`
        SELECT * FROM inspirations
        WHERE id = ${delivery.inspiration_id}
        FOR UPDATE
      `;
      const inspiration = inspirationRows[0];
      if (!inspiration) {
        throw new FlowStoreError(
          "NOT_FOUND",
          `inspiration ${delivery.inspiration_id} not found`,
          404
        );
      }
      if (
        delivery.version !== expectedDeliveryVersion ||
        inspiration.version !== expectedInspirationVersion
      ) {
        throw new FlowStoreError(
          "VERSION_CONFLICT",
          "Flow outcome version conflict",
          409,
          delivery.version,
          inspiration.version
        );
      }
      if (delivery.status !== "sent") {
        throw new FlowStoreError(
          "INVALID_STATE",
          `delivery ${deliveryId} is ${delivery.status}, not sent`,
          409,
          delivery.version,
          inspiration.version
        );
      }

      let finalInspiration = inspiration;
      if (outcome === "kept" || outcome === "archived") {
        const lifecycleRows = outcome === "kept"
          ? await transaction<InspirationRow[]>`
              UPDATE inspirations
              SET status = 'kept', archived_at = NULL,
                  version = version + 1, updated_at = ${now}
              WHERE id = ${inspiration.id}
                AND version = ${expectedInspirationVersion}
              RETURNING *
            `
          : await transaction<InspirationRow[]>`
              UPDATE inspirations
              SET status = 'archived', archived_at = ${now},
                  version = version + 1, updated_at = ${now}
              WHERE id = ${inspiration.id}
                AND version = ${expectedInspirationVersion}
              RETURNING *
            `;
        if (!lifecycleRows[0]) {
          throw new FlowStoreError(
            "VERSION_CONFLICT",
            "inspiration version conflict while recording Flow outcome",
            409,
            delivery.version,
            inspiration.version
          );
        }
        finalInspiration = lifecycleRows[0];
      }

      const updatedDeliveryRows = await transaction<DeliveryRow[]>`
        UPDATE inspiration_flow_deliveries
        SET status = 'acted', outcome = ${outcome}, outcome_at = ${now},
            snoozed_until = ${outcome === "later" ? snoozedUntil : null},
            version = version + 1, updated_at = ${now}
        WHERE id = ${deliveryId}
          AND version = ${expectedDeliveryVersion}
          AND status = 'sent'
        RETURNING *
      `;
      if (!updatedDeliveryRows[0]) {
        throw new FlowStoreError(
          "VERSION_CONFLICT",
          "delivery version conflict while recording Flow outcome",
          409,
          delivery.version,
          inspiration.version
        );
      }
      return {
        delivery: mapDelivery(updatedDeliveryRows[0]),
        inspiration: mapInspiration(finalInspiration),
      };
    });
  }

  async getDailySummary(localDate: string): Promise<DailyInspirationSummary> {
    const { start, end } = dateBounds(localDate);
    const [capturedRows, surfacedRows, outcomeRows] = await Promise.all([
      this.sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM inspirations
        WHERE created_at >= ${start} AND created_at < ${end}
      `,
      this.sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM inspiration_flow_deliveries
        WHERE surfaced_at >= ${start} AND surfaced_at < ${end}
      `,
      this.sql<{ outcome: FlowOutcome; count: number }[]>`
        SELECT outcome, COUNT(*)::int AS count
        FROM inspiration_flow_deliveries
        WHERE outcome_at >= ${start} AND outcome_at < ${end}
          AND outcome IS NOT NULL
        GROUP BY outcome
      `,
    ]);
    return {
      captured: capturedRows[0]?.count ?? 0,
      surfaced: surfacedRows[0]?.count ?? 0,
      outcomes: Object.fromEntries(
        outcomeRows.map((row) => [row.outcome, row.count])
      ),
    };
  }
}
