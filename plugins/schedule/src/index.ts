import type {
  PluginDefinition,
  PluginManifest,
} from "@echolog/plugin-sdk";
import manifestJson from "../echolog.plugin.json";
import { pollDueReminders } from "./reminders.js";
import { createScheduleRoutes } from "./routes.js";
import { ScheduleStore } from "./store.js";
import type { NotificationSend } from "./types.js";

const manifest = manifestJson as PluginManifest;
let currentStore: ScheduleStore | null = null;
let notificationSend: NotificationSend | null = null;

export const SCHEDULE_REMINDER_JOB_TIMEOUT_MS = 25_000;

function requireStore(): ScheduleStore {
  if (!currentStore) throw new Error("schedule store is not initialized");
  return currentStore;
}

function requireNotificationSend(): NotificationSend {
  if (!notificationSend) {
    throw new Error("schedule notifications service is not initialized");
  }
  return notificationSend;
}

function reminderPollSeconds(config: Readonly<Record<string, unknown>>): number {
  const value = config.reminder_poll_seconds;
  return typeof value === "number" && Number.isInteger(value) ? value : 30;
}

export const schedulePlugin: PluginDefinition = {
  manifest,
  routes: createScheduleRoutes(requireStore),
  defaultEnabled: true,
  defaultConfig: {
    reminder_poll_seconds: 30,
  },
  normalizeConfig(config) {
    return {
      reminder_poll_seconds: config.reminder_poll_seconds ?? 30,
    };
  },
  validateConfig(config) {
    const value = config.reminder_poll_seconds;
    return typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 3_600
      ? []
      : ["reminder_poll_seconds must be an integer from 1 to 3600"];
  },
  migrations: [{
    name: "001_schedule_items_and_reminder_deliveries",
    sql: `
      CREATE TABLE IF NOT EXISTS schedule_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        scheduled_start_at TIMESTAMPTZ NOT NULL,
        scheduled_end_at TIMESTAMPTZ,
        timezone TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'scheduled',
        next_reminder_at TIMESTAMPTZ,
        confirmed_start_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT schedule_items_title_check
          CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
        CONSTRAINT schedule_items_description_check
          CHECK (description IS NULL OR char_length(description) <= 5000),
        CONSTRAINT schedule_items_timezone_check
          CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 100),
        CONSTRAINT schedule_items_status_check
          CHECK (status IN ('scheduled', 'active', 'done', 'cancelled')),
        CONSTRAINT schedule_items_version_check CHECK (version >= 1),
        CONSTRAINT schedule_items_priority_check
          CHECK (priority BETWEEN -1000 AND 1000),
        CONSTRAINT schedule_items_interval_check
          CHECK (scheduled_end_at IS NULL OR scheduled_end_at > scheduled_start_at),
        CONSTRAINT schedule_items_state_timestamps_check CHECK (
          (status = 'scheduled'
            AND confirmed_start_at IS NULL
            AND completed_at IS NULL
            AND cancelled_at IS NULL)
          OR (status = 'active'
            AND confirmed_start_at IS NOT NULL
            AND completed_at IS NULL
            AND cancelled_at IS NULL
            AND next_reminder_at IS NULL)
          OR (status = 'done'
            AND completed_at IS NOT NULL
            AND cancelled_at IS NULL
            AND next_reminder_at IS NULL)
          OR (status = 'cancelled'
            AND completed_at IS NULL
            AND cancelled_at IS NOT NULL
            AND next_reminder_at IS NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_items_status_reminder
        ON schedule_items(status, next_reminder_at);
      CREATE INDEX IF NOT EXISTS idx_schedule_items_calendar_range
        ON schedule_items(scheduled_start_at, scheduled_end_at);

      CREATE TABLE IF NOT EXISTS schedule_reminder_deliveries (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        item_id TEXT NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
        reminder_at TIMESTAMPTZ NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        status TEXT NOT NULL,
        channel_results JSONB,
        failure TEXT,
        CONSTRAINT schedule_reminder_deliveries_status_check
          CHECK (status IN ('claimed', 'sent', 'failed')),
        CONSTRAINT schedule_reminder_deliveries_failure_check
          CHECK (failure IS NULL OR char_length(failure) <= 1000),
        CONSTRAINT schedule_reminder_deliveries_terminal_check CHECK (
          (status = 'claimed' AND completed_at IS NULL AND channel_results IS NULL)
          OR (status = 'sent' AND completed_at IS NOT NULL AND channel_results IS NOT NULL)
          OR (status = 'failed' AND completed_at IS NOT NULL)
        )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_dedupe_key
        ON schedule_reminder_deliveries(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_attempted_at
        ON schedule_reminder_deliveries(attempted_at);
    `,
  }, {
    name: "002_schedule_delivery_lookup_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_schedule_reminder_deliveries_item_reminder
        ON schedule_reminder_deliveries(item_id, reminder_at);
    `,
  }],
  register(context) {
    currentStore = new ScheduleStore(context.service<string>("database.url"));
    notificationSend = context.service<NotificationSend>("notifications.send");
    context.registerJob({
      id: "reminder-poll",
      intervalMs: reminderPollSeconds(context.config) * 1_000,
      timeoutMs: SCHEDULE_REMINDER_JOB_TIMEOUT_MS,
      async run(signal) {
        await pollDueReminders(
          requireStore(),
          requireNotificationSend(),
          signal
        );
      },
    });
  },
  start(context) {
    context.logger.info(
      { reminderPollSeconds: reminderPollSeconds(context.config) },
      "Schedule plugin started"
    );
  },
  async stop() {
    await currentStore?.close();
    currentStore = null;
    notificationSend = null;
  },
};

export default schedulePlugin;

export { pollDueReminders } from "./reminders.js";
export { createScheduleRoutes } from "./routes.js";
export {
  SCHEDULE_CLAIM_TIMEOUT_MS,
  ScheduleClaimTimeoutError,
  ScheduleConflictError,
  ScheduleNotFoundError,
  ScheduleStore,
  reminderDedupeKey,
  scheduleItemFromRow,
} from "./store.js";
export type { ScheduleStoreOptions } from "./store.js";
export type {
  NotificationSend,
  NotificationSendResult,
  ReminderDelivery,
  ScheduleItem,
  ScheduleStatus,
} from "./types.js";
