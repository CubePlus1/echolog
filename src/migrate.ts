import postgres from "postgres";
import { getDbUrl } from "./core/config.js";

const MIGRATIONS = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS records (
        id              TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        type            TEXT NOT NULL CHECK(type IN ('learning','project','task')),
        tags            TEXT[] NOT NULL DEFAULT '{}'::text[],
        project         TEXT,
        start_at        TIMESTAMPTZ NOT NULL,
        end_at          TIMESTAMPTZ,
        status          TEXT NOT NULL CHECK(status IN ('running','paused','done','cancelled')),
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        result          TEXT,
        source          TEXT NOT NULL DEFAULT 'cli',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notes (
        id              TEXT PRIMARY KEY,
        record_id       TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'note' CHECK(type IN ('note','blocker','next')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pauses (
        id              TEXT PRIMARY KEY,
        record_id       TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        paused_at       TIMESTAMPTZ NOT NULL,
        resumed_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
      CREATE INDEX IF NOT EXISTS idx_records_start_at ON records(start_at);
      CREATE INDEX IF NOT EXISTS idx_records_project ON records(project);
      CREATE INDEX IF NOT EXISTS idx_notes_record ON notes(record_id);
      CREATE INDEX IF NOT EXISTS idx_pauses_record ON pauses(record_id);

      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    name: "002_screen_tracking",
    sql: `
      CREATE TABLE IF NOT EXISTS app_usage (
        id              TEXT PRIMARY KEY,
        bundle_id       TEXT NOT NULL,
        app_name        TEXT NOT NULL,
        start_at        TIMESTAMPTZ NOT NULL,
        end_at          TIMESTAMPTZ NOT NULL,
        seconds         INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS app_rules (
        id              TEXT PRIMARY KEY,
        app_match       TEXT NOT NULL,
        label           TEXT NOT NULL,
        start_minute    INTEGER,
        end_minute      INTEGER,
        weekdays        INTEGER[],
        priority        INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_app_usage_start_at ON app_usage(start_at);
    `,
  },
];

async function migrate() {
  const sql = postgres(getDbUrl());

  try {
    await sql`CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    const applied = await sql`SELECT name FROM migrations`;
    const appliedNames = new Set(applied.map((r) => r.name));

    for (const m of MIGRATIONS) {
      if (appliedNames.has(m.name)) {
        console.log(`  skip: ${m.name} (already applied)`);
        continue;
      }
      console.log(`  applying: ${m.name}`);
      await sql.unsafe(m.sql);
      await sql`INSERT INTO migrations (name) VALUES (${m.name})`;
      console.log(`  done: ${m.name}`);
    }

    console.log("Migrations complete.");
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
