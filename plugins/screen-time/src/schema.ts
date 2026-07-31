import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

export type AppUsage = typeof appUsage.$inferSelect;
export type AppRule = typeof appRules.$inferSelect;
