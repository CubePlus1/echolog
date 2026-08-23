import { sql } from "drizzle-orm";
import {
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
  NotificationSendResult,
  ReminderDeliveryStatus,
  ScheduleStatus,
} from "./types.js";

export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true })
      .notNull(),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").$type<ScheduleStatus>().notNull().default("scheduled"),
    nextReminderAt: timestamp("next_reminder_at", { withTimezone: true }),
    confirmedStartAt: timestamp("confirmed_start_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "schedule_items_title_check",
      sql`char_length(btrim(${table.title})) BETWEEN 1 AND 200`
    ),
    check(
      "schedule_items_description_check",
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 5000`
    ),
    check(
      "schedule_items_timezone_check",
      sql`char_length(btrim(${table.timezone})) BETWEEN 1 AND 100`
    ),
    check(
      "schedule_items_status_check",
      sql`${table.status} IN ('scheduled', 'active', 'done', 'cancelled')`
    ),
    check("schedule_items_version_check", sql`${table.version} >= 1`),
    check(
      "schedule_items_priority_check",
      sql`${table.priority} BETWEEN -1000 AND 1000`
    ),
    check(
      "schedule_items_interval_check",
      sql`${table.scheduledEndAt} IS NULL OR ${table.scheduledEndAt} > ${table.scheduledStartAt}`
    ),
    check(
      "schedule_items_state_timestamps_check",
      sql`(${table.status} = 'scheduled'
          AND ${table.confirmedStartAt} IS NULL
          AND ${table.completedAt} IS NULL
          AND ${table.cancelledAt} IS NULL)
        OR (${table.status} = 'active'
          AND ${table.confirmedStartAt} IS NOT NULL
          AND ${table.completedAt} IS NULL
          AND ${table.cancelledAt} IS NULL
          AND ${table.nextReminderAt} IS NULL)
        OR (${table.status} = 'done'
          AND ${table.completedAt} IS NOT NULL
          AND ${table.cancelledAt} IS NULL
          AND ${table.nextReminderAt} IS NULL)
        OR (${table.status} = 'cancelled'
          AND ${table.completedAt} IS NULL
          AND ${table.cancelledAt} IS NOT NULL
          AND ${table.nextReminderAt} IS NULL)`
    ),
    index("idx_schedule_items_status_reminder").on(
      table.status,
      table.nextReminderAt
    ),
    index("idx_schedule_items_calendar_range").on(
      table.scheduledStartAt,
      table.scheduledEndAt
    ),
  ]
);

export const scheduleReminderDeliveries = pgTable(
  "schedule_reminder_deliveries",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => scheduleItems.id, { onDelete: "cascade" }),
    reminderAt: timestamp("reminder_at", { withTimezone: true }).notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: text("status").$type<ReminderDeliveryStatus>().notNull(),
    channelResults: jsonb("channel_results")
      .$type<NotificationSendResult["channels"]>(),
    failure: text("failure"),
  },
  (table) => [
    uniqueIndex("idx_schedule_reminder_deliveries_dedupe_key").on(
      table.dedupeKey
    ),
    index("idx_schedule_reminder_deliveries_item_reminder").on(
      table.itemId,
      table.reminderAt
    ),
    index("idx_schedule_reminder_deliveries_attempted_at").on(table.attemptedAt),
    check(
      "schedule_reminder_deliveries_status_check",
      sql`${table.status} IN ('claimed', 'sent', 'failed')`
    ),
    check(
      "schedule_reminder_deliveries_failure_check",
      sql`${table.failure} IS NULL OR char_length(${table.failure}) <= 1000`
    ),
    check(
      "schedule_reminder_deliveries_terminal_check",
      sql`(${table.status} = 'claimed' AND ${table.completedAt} IS NULL AND ${table.channelResults} IS NULL)
        OR (${table.status} = 'sent' AND ${table.completedAt} IS NOT NULL AND ${table.channelResults} IS NOT NULL)
        OR (${table.status} = 'failed' AND ${table.completedAt} IS NOT NULL)`
    ),
  ]
);

export type ScheduleItemRow = typeof scheduleItems.$inferSelect;
export type ScheduleReminderDeliveryRow =
  typeof scheduleReminderDeliveries.$inferSelect;
