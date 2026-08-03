import { createHash } from "crypto";
import postgres from "postgres";
import type { PluginMigration } from "@echolog/plugin-sdk";
import { getDbUrl } from "../config.js";

export type PluginMigrationRunner = (
  pluginId: string,
  migrations: readonly PluginMigration[]
) => Promise<void>;

export function migrationChecksum(migration: PluginMigration): string {
  return createHash("sha256").update(migration.sql).digest("hex");
}

export const runPluginMigrations: PluginMigrationRunner = async (
  pluginId,
  migrations
) => {
  if (migrations.length === 0) return;
  const sql = postgres(getDbUrl());
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS plugin_migrations (
        plugin_id TEXT NOT NULL,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (plugin_id, name)
      )
    `;

    const applied = await sql<
      { name: string; checksum: string }[]
    >`SELECT name, checksum FROM plugin_migrations WHERE plugin_id = ${pluginId}`;
    const byName = new Map(applied.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const checksum = migrationChecksum(migration);
      const existing = byName.get(migration.name);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(
            `Plugin migration checksum drift: ${pluginId}/${migration.name}`
          );
        }
        continue;
      }

      await sql.begin(async (tx) => {
        await tx.unsafe(migration.sql);
        await tx`
          INSERT INTO plugin_migrations (plugin_id, name, checksum)
          VALUES (${pluginId}, ${migration.name}, ${checksum})
        `;
      });
    }
  } finally {
    await sql.end();
  }
};
