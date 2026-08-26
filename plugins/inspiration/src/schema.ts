import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  PluginNotificationResult,
} from "@echolog/plugin-sdk";
import type {
  FlowDeliveryStatus,
  FlowOutcome,
  FlowSource,
  InspirationStatus,
} from "./types.js";

export const inspirations = pgTable(
  "inspirations",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    content: text("content").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    project: text("project"),
    status: text("status").$type<InspirationStatus>().notNull().default("inbox"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    lastSurfacedAt: timestamp("last_surfaced_at", { withTimezone: true }),
  },
  (table) => [
    check("inspirations_version_check", sql`${table.version} >= 1`),
    check(
      "inspirations_content_check",
      sql`char_length(trim(${table.content})) BETWEEN 1 AND 10000`
    ),
    check(
      "inspirations_status_check",
      sql`${table.status} IN ('inbox', 'kept', 'archived')`
    ),
    check(
      "inspirations_archive_check",
      sql`(${table.status} = 'archived') = (${table.archivedAt} IS NOT NULL)`
    ),
    index("idx_inspirations_flow_selection").on(
      table.status,
      table.lastSurfacedAt.asc().nullsFirst(),
      table.createdAt.asc(),
      table.id.asc()
    ),
    index("idx_inspirations_history").on(
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_inspirations_project_status").on(table.project, table.status),
    index("idx_inspirations_tags").using("gin", table.tags),
  ]
);

export const inspirationFlowSettings = pgTable(
  "inspiration_flow_settings",
  {
    id: text("id").primaryKey().default("default"),
    version: integer("version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(false),
    intervalMinutes: integer("interval_minutes").notNull().default(240),
    quietStartMinute: integer("quiet_start_minute").notNull().default(1_320),
    quietEndMinute: integer("quiet_end_minute").notNull().default(480),
    cooldownMinutes: integer("cooldown_minutes").notNull().default(1_440),
    dailyLimit: integer("daily_limit").notNull().default(3),
    defaultSnoozeMinutes: integer("default_snooze_minutes").notNull().default(1_440),
    statuses: text("statuses")
      .array()
      .notNull()
      .default(sql`ARRAY['inbox', 'kept']::text[]`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    projects: text("projects").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("inspiration_flow_settings_singleton", sql`${table.id} = 'default'`),
    check("inspiration_flow_settings_version_check", sql`${table.version} >= 1`),
    check(
      "inspiration_flow_settings_interval_check",
      sql`${table.intervalMinutes} BETWEEN 1 AND 10080`
    ),
    check(
      "inspiration_flow_settings_quiet_start_check",
      sql`${table.quietStartMinute} BETWEEN 0 AND 1439`
    ),
    check(
      "inspiration_flow_settings_quiet_end_check",
      sql`${table.quietEndMinute} BETWEEN 0 AND 1439`
    ),
    check(
      "inspiration_flow_settings_cooldown_check",
      sql`${table.cooldownMinutes} BETWEEN 0 AND 525600`
    ),
    check(
      "inspiration_flow_settings_daily_limit_check",
      sql`${table.dailyLimit} BETWEEN 1 AND 1000`
    ),
    check(
      "inspiration_flow_settings_snooze_check",
      sql`${table.defaultSnoozeMinutes} BETWEEN 1 AND 525600`
    ),
    check(
      "inspiration_flow_settings_statuses_check",
      sql`${table.statuses} <@ ARRAY['inbox', 'kept']::text[]`
    ),
  ]
);

export const inspirationFlowDeliveries = pgTable(
  "inspiration_flow_deliveries",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    attempts: integer("attempts").notNull().default(1),
    inspirationId: text("inspiration_id")
      .notNull()
      .references(() => inspirations.id, { onDelete: "restrict" }),
    source: text("source").$type<FlowSource>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").$type<FlowDeliveryStatus>().notNull(),
    outcome: text("outcome").$type<FlowOutcome>(),
    surfacedAt: timestamp("surfaced_at", { withTimezone: true }).notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    notificationChannel: text("notification_channel"),
    notificationChannels: jsonb("notification_channels")
      .$type<PluginNotificationResult["channels"]>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("inspiration_flow_deliveries_version_check", sql`${table.version} >= 1`),
    check("inspiration_flow_deliveries_attempts_check", sql`${table.attempts} >= 1`),
    check(
      "inspiration_flow_deliveries_source_check",
      sql`${table.source} IN ('manual', 'scheduled')`
    ),
    check(
      "inspiration_flow_deliveries_status_check",
      sql`${table.status} IN ('reserved', 'dispatching', 'sent', 'failed', 'acted')`
    ),
    check(
      "inspiration_flow_deliveries_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('viewed', 'continued', 'kept', 'later', 'archived')`
    ),
    check(
      "inspiration_flow_deliveries_acted_check",
      sql`(${table.status} = 'acted') = (${table.outcome} IS NOT NULL AND ${table.outcomeAt} IS NOT NULL)`
    ),
    uniqueIndex("idx_inspiration_flow_deliveries_dedupe_key").on(table.dedupeKey),
    index("idx_inspiration_flow_deliveries_inspiration_surfaced").on(
      table.inspirationId,
      table.surfacedAt.desc()
    ),
    index("idx_inspiration_flow_deliveries_status_created").on(
      table.status,
      table.createdAt
    ),
    index("idx_inspiration_flow_deliveries_surfaced_at").on(table.surfacedAt),
    index("idx_inspiration_flow_deliveries_snoozed_until").on(table.snoozedUntil),
  ]
);

export type InspirationRow = typeof inspirations.$inferSelect;
export type InspirationFlowSettingsRow = typeof inspirationFlowSettings.$inferSelect;
export type InspirationFlowDeliveryRow = typeof inspirationFlowDeliveries.$inferSelect;
