import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { nanoid } from "nanoid";
import {
  appRules,
  appUsage,
  screenUnderstandingSettings,
  type AppRule,
  type ScreenUnderstandingSettings,
} from "./schema.js";
import {
  DEFAULT_UNDERSTANDING_SETTINGS,
  type UnderstandingSettingsInput,
} from "./understanding-settings.js";

export interface CreateRuleInput {
  appMatch: string;
  label: string;
  startMinute?: number | null;
  endMinute?: number | null;
  weekdays?: number[] | null;
  priority?: number;
}

export class ScreenStore {
  private readonly sql;
  private readonly db;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl);
    this.db = drizzle(this.sql);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async insertUsage(row: typeof appUsage.$inferInsert): Promise<void> {
    await this.db.insert(appUsage).values(row);
  }

  async updateUsage(id: string, endAt: Date, seconds: number): Promise<void> {
    await this.db
      .update(appUsage)
      .set({ endAt, seconds })
      .where(eq(appUsage.id, id));
  }

  async usageBetween(dayStart: Date, dayEnd: Date) {
    return this.db
      .select()
      .from(appUsage)
      .where(and(gt(appUsage.endAt, dayStart), lt(appUsage.startAt, dayEnd)))
      .orderBy(asc(appUsage.startAt));
  }

  async listRules(): Promise<AppRule[]> {
    return this.db
      .select()
      .from(appRules)
      .orderBy(desc(appRules.priority), asc(appRules.createdAt));
  }

  async createRule(input: CreateRuleInput): Promise<AppRule> {
    const [inserted] = await this.db
      .insert(appRules)
      .values({
        id: nanoid(12),
        appMatch: input.appMatch,
        label: input.label,
        startMinute: input.startMinute ?? null,
        endMinute: input.endMinute ?? null,
        weekdays: input.weekdays ?? null,
        priority: input.priority ?? 0,
        createdAt: new Date(),
      })
      .returning();
    return inserted;
  }

  async deleteRule(id: string): Promise<AppRule | null> {
    const [deleted] = await this.db
      .delete(appRules)
      .where(eq(appRules.id, id))
      .returning();
    return deleted ?? null;
  }

  async getUnderstandingSettings(): Promise<ScreenUnderstandingSettings> {
    await this.db
      .insert(screenUnderstandingSettings)
      .values({
        id: "default",
        ...DEFAULT_UNDERSTANDING_SETTINGS,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(screenUnderstandingSettings)
      .where(eq(screenUnderstandingSettings.id, "default"));
    if (!row) throw new Error("screen understanding settings row is unavailable");
    return row;
  }

  async updateUnderstandingSettings(
    expectedVersion: number,
    input: UnderstandingSettingsInput
  ): Promise<ScreenUnderstandingSettings | null> {
    const [updated] = await this.db
      .update(screenUnderstandingSettings)
      .set({
        ...input,
        version: sql`${screenUnderstandingSettings.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(screenUnderstandingSettings.id, "default"),
        eq(screenUnderstandingSettings.version, expectedVersion)
      ))
      .returning();
    return updated ?? null;
  }
}
