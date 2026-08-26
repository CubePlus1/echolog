import type { PluginMigration } from "@echolog/plugin-sdk";

export const migrations: PluginMigration[] = [
  {
    name: "001_inspirations",
    sql: `
      CREATE TABLE IF NOT EXISTS inspirations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}'::text[],
        project TEXT,
        status TEXT NOT NULL DEFAULT 'inbox',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        archived_at TIMESTAMPTZ,
        last_surfaced_at TIMESTAMPTZ,
        CONSTRAINT inspirations_version_check CHECK (version >= 1),
        CONSTRAINT inspirations_content_check
          CHECK (char_length(trim(content)) BETWEEN 1 AND 10000),
        CONSTRAINT inspirations_status_check
          CHECK (status IN ('inbox', 'kept', 'archived')),
        CONSTRAINT inspirations_archive_check
          CHECK ((status = 'archived') = (archived_at IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_inspirations_flow_selection
        ON inspirations(
          status,
          last_surfaced_at ASC NULLS FIRST,
          created_at ASC,
          id ASC
        );
      CREATE INDEX IF NOT EXISTS idx_inspirations_history
        ON inspirations(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_inspirations_project_status
        ON inspirations(project, status);
      CREATE INDEX IF NOT EXISTS idx_inspirations_tags
        ON inspirations USING GIN(tags);
    `,
  },
  {
    name: "002_inspiration_flow_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS inspiration_flow_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        version INTEGER NOT NULL DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        interval_minutes INTEGER NOT NULL DEFAULT 240,
        quiet_start_minute INTEGER NOT NULL DEFAULT 1320,
        quiet_end_minute INTEGER NOT NULL DEFAULT 480,
        cooldown_minutes INTEGER NOT NULL DEFAULT 1440,
        daily_limit INTEGER NOT NULL DEFAULT 3,
        default_snooze_minutes INTEGER NOT NULL DEFAULT 1440,
        statuses TEXT[] NOT NULL DEFAULT ARRAY['inbox', 'kept']::text[],
        tags TEXT[] NOT NULL DEFAULT '{}'::text[],
        projects TEXT[] NOT NULL DEFAULT '{}'::text[],
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT inspiration_flow_settings_singleton CHECK (id = 'default'),
        CONSTRAINT inspiration_flow_settings_version_check CHECK (version >= 1),
        CONSTRAINT inspiration_flow_settings_interval_check
          CHECK (interval_minutes BETWEEN 1 AND 10080),
        CONSTRAINT inspiration_flow_settings_quiet_start_check
          CHECK (quiet_start_minute BETWEEN 0 AND 1439),
        CONSTRAINT inspiration_flow_settings_quiet_end_check
          CHECK (quiet_end_minute BETWEEN 0 AND 1439),
        CONSTRAINT inspiration_flow_settings_cooldown_check
          CHECK (cooldown_minutes BETWEEN 0 AND 525600),
        CONSTRAINT inspiration_flow_settings_daily_limit_check
          CHECK (daily_limit BETWEEN 1 AND 1000),
        CONSTRAINT inspiration_flow_settings_snooze_check
          CHECK (default_snooze_minutes BETWEEN 1 AND 525600),
        CONSTRAINT inspiration_flow_settings_statuses_check
          CHECK (statuses <@ ARRAY['inbox', 'kept']::text[])
      );
      INSERT INTO inspiration_flow_settings (id)
        VALUES ('default')
        ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    name: "003_inspiration_flow_deliveries",
    sql: `
      CREATE TABLE IF NOT EXISTS inspiration_flow_deliveries (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        inspiration_id TEXT NOT NULL REFERENCES inspirations(id)
          ON DELETE RESTRICT,
        source TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT,
        surfaced_at TIMESTAMPTZ NOT NULL,
        notified_at TIMESTAMPTZ,
        snoozed_until TIMESTAMPTZ,
        outcome_at TIMESTAMPTZ,
        notification_channel TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT inspiration_flow_deliveries_version_check CHECK (version >= 1),
        CONSTRAINT inspiration_flow_deliveries_source_check
          CHECK (source IN ('manual', 'scheduled')),
        CONSTRAINT inspiration_flow_deliveries_status_check
          CHECK (status IN ('reserved', 'sent', 'failed', 'acted')),
        CONSTRAINT inspiration_flow_deliveries_outcome_check
          CHECK (outcome IS NULL OR outcome IN ('viewed', 'continued', 'kept', 'later', 'archived')),
        CONSTRAINT inspiration_flow_deliveries_acted_check
          CHECK ((status = 'acted') = (outcome IS NOT NULL AND outcome_at IS NOT NULL))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_flow_deliveries_dedupe_key
        ON inspiration_flow_deliveries(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_inspiration_flow_deliveries_inspiration_surfaced
        ON inspiration_flow_deliveries(inspiration_id, surfaced_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inspiration_flow_deliveries_status_created
        ON inspiration_flow_deliveries(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_inspiration_flow_deliveries_surfaced_at
        ON inspiration_flow_deliveries(surfaced_at);
      CREATE INDEX IF NOT EXISTS idx_inspiration_flow_deliveries_snoozed_until
        ON inspiration_flow_deliveries(snoozed_until);
    `,
  },
  {
    name: "004_inspiration_flow_delivery_attempts",
    sql: `
      ALTER TABLE inspiration_flow_deliveries
        ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE inspiration_flow_deliveries
        DROP CONSTRAINT IF EXISTS inspiration_flow_deliveries_attempts_check;
      ALTER TABLE inspiration_flow_deliveries
        ADD CONSTRAINT inspiration_flow_deliveries_attempts_check
        CHECK (attempts >= 1);
    `,
  },
  {
    name: "005_inspiration_flow_notification_channels",
    sql: `
      ALTER TABLE inspiration_flow_deliveries
        ADD COLUMN IF NOT EXISTS notification_channels JSONB;
    `,
  },
  {
    name: "006_inspiration_flow_dispatching_status",
    sql: `
      ALTER TABLE inspiration_flow_deliveries
        DROP CONSTRAINT IF EXISTS inspiration_flow_deliveries_status_check;
      ALTER TABLE inspiration_flow_deliveries
        ADD CONSTRAINT inspiration_flow_deliveries_status_check
        CHECK (status IN ('reserved', 'dispatching', 'sent', 'failed', 'acted'));
    `,
  },
];
