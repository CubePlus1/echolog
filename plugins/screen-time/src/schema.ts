import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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

export const screenUnderstandingSettings = pgTable(
  "screen_understanding_settings",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(false),
    captureIntervalSeconds: integer("capture_interval_seconds")
      .notNull()
      .default(60),
    captureDisplay: text("capture_display").notNull().default("active"),
    skipWhenIdle: boolean("skip_when_idle").notNull().default(true),
    providerProfileId: text("provider_profile_id"),
    requestTimeoutMs: integer("request_timeout_ms").notNull().default(30_000),
    maxConcurrency: integer("max_concurrency").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(3),
    dailyRequestBudget: integer("daily_request_budget").notNull().default(480),
    dailyCostBudgetMicros: integer("daily_cost_budget_micros")
      .notNull()
      .default(0),
    remoteConsentOrigin: text("remote_consent_origin"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export const screenUnderstandingProviderProfiles = pgTable(
  "screen_understanding_provider_profiles",
  {
    id: text("id").primaryKey(),
    version: integer("version").notNull().default(1),
    displayName: text("display_name").notNull(),
    providerKind: text("provider_kind").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export const screenUnderstandingRequests = pgTable(
  "screen_understanding_requests",
  {
    id: text("id").primaryKey(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    providerProfileId: text("provider_profile_id").notNull(),
    status: text("status").notNull(),
    costMicros: integer("cost_micros").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("idx_screen_understanding_requests_requested_at").on(table.requestedAt)]
);

export const screenUnderstandingObservations = pgTable(
  "screen_understanding_observations",
  {
    id: text("id").primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    providerProfileId: text("provider_profile_id").notNull(),
    model: text("model").notNull(),
    summary: text("summary").notNull(),
    activity: text("activity").notNull(),
    confidence: real("confidence").notNull(),
    sensitive: boolean("sensitive").notNull().default(false),
    apps: jsonb("apps").$type<string[]>().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costMicros: integer("cost_micros"),
  },
  (table) => [index("idx_screen_understanding_observations_captured_at").on(table.capturedAt)]
);

export type AppUsage = typeof appUsage.$inferSelect;
export type AppRule = typeof appRules.$inferSelect;
export type ScreenUnderstandingSettings =
  typeof screenUnderstandingSettings.$inferSelect;
export type ScreenUnderstandingProviderProfile =
  typeof screenUnderstandingProviderProfiles.$inferSelect;
export type ScreenUnderstandingRequest =
  typeof screenUnderstandingRequests.$inferSelect;
export type ScreenUnderstandingObservation =
  typeof screenUnderstandingObservations.$inferSelect;
