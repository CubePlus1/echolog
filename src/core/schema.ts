import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const records = pgTable(
  "records",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    project: text("project"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    status: text("status").notNull(),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    result: text("result"),
    source: text("source").notNull().default("cli"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_records_status").on(table.status),
    index("idx_records_start_at").on(table.startAt),
    index("idx_records_project").on(table.project),
    check(
      "records_type_check",
      sql`${table.type} IN ('learning','project','task')`
    ),
    check(
      "records_status_check",
      sql`${table.status} IN ('running','paused','done','cancelled')`
    ),
  ]
);

export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    type: text("type").notNull().default("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_notes_record").on(table.recordId),
    check(
      "notes_type_check",
      sql`${table.type} IN ('note','blocker','next')`
    ),
  ]
);

export const pauses = pgTable(
  "pauses",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull(),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_pauses_record").on(table.recordId)]
);

export const appUsage = pgTable(
  "app_usage",
  {
    id: text("id").primaryKey(),
    bundleId: text("bundle_id").notNull(),
    appName: text("app_name").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    seconds: integer("seconds").notNull().default(0),
  },
  (table) => [index("idx_app_usage_start_at").on(table.startAt)]
);

export const appRules = pgTable("app_rules", {
  id: text("id").primaryKey(),
  appMatch: text("app_match").notNull(),
  label: text("label").notNull(),
  startMinute: integer("start_minute"),
  endMinute: integer("end_minute"),
  weekdays: integer("weekdays").array(),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Record = typeof records.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Pause = typeof pauses.$inferSelect;
export type AppUsage = typeof appUsage.$inferSelect;
export type AppRule = typeof appRules.$inferSelect;
