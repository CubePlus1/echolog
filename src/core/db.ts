import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbUrl } from "./config.js";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let client: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!db) {
    client = postgres(getDbUrl());
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

export type Db = ReturnType<typeof getDb>;
