import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const tmuxSessions = pgTable("tmux_sessions", {
  sessionKey: text("session_key").primaryKey(),
  sessionName: text("session_name").notNull(),
  sessionId: text("session_id"),
  sessionCreated: bigint("session_created", { mode: "number" }),
  firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
  lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
});

export const tmuxPaneMinutes = pgTable(
  "tmux_pane_minutes",
  {
    sessionKey: text("session_key").notNull(),
    paneIdentity: text("pane_identity").notNull(),
    minuteBucket: timestamp("minute_bucket", { withTimezone: true }).notNull(),
    paneId: text("pane_id").notNull(),
    panePid: integer("pane_pid").notNull(),
    windowId: text("window_id"),
    target: text("target").notNull(),
    tools: text("tools").array().notNull().default([]),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }).notNull(),
    sampleCount: integer("sample_count").notNull().default(1),
    cpuAverage: doublePrecision("cpu_average").notNull().default(0),
    cpuPeak: doublePrecision("cpu_peak").notNull().default(0),
    memoryPeakMb: doublePrecision("memory_peak_mb").notNull().default(0),
    anomalyCount: integer("anomaly_count").notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionKey, table.paneIdentity, table.minuteBucket],
      name: "tmux_pane_minutes_pkey",
    }),
    index("idx_tmux_pane_minutes_bucket").on(table.minuteBucket),
  ]
);

export const tmuxAgentConversations = pgTable(
  "tmux_agent_conversations",
  {
    observationKey: text("observation_key").primaryKey(),
    sessionKey: text("session_key").notNull(),
    paneIdentity: text("pane_identity").notNull(),
    tmuxTarget: text("tmux_target").notNull(),
    paneId: text("pane_id").notNull(),
    panePid: integer("pane_pid").notNull(),
    agentProcessPids: integer("agent_process_pids").array().notNull().default([]),
    processInstances: jsonb("process_instances")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    workingDirectory: text("working_directory"),
    tool: text("tool").notNull(),
    conversationIdKind: text("conversation_id_kind").notNull(),
    conversationId: text("conversation_id"),
    conversationIdStatus: text("conversation_id_status").notNull(),
    identitySource: text("identity_source").notNull(),
    sourcePath: text("source_path"),
    stableMappingKey: text("stable_mapping_key"),
    resumeCommand: text("resume_command"),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_tmux_agent_conversations_last_observed").on(table.lastObservedAt),
  ]
);
