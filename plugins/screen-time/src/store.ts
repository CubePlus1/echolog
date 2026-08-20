import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { nanoid } from "nanoid";
import {
  appRules,
  appUsage,
  screenUnderstandingObservations,
  screenUnderstandingProviderProfiles,
  screenUnderstandingRequests,
  screenUnderstandingSettings,
  type AppRule,
  type ScreenUnderstandingProviderProfile,
  type ScreenUnderstandingObservation,
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

export interface ProviderProfileMetadataInput {
  id: string;
  displayName: string;
  providerKind: "openai-compatible";
  baseUrl: string;
  model: string;
}

export type ProviderProfileMutableInput = Omit<ProviderProfileMetadataInput, "id">;

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

  async countProviderProfiles(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(screenUnderstandingProviderProfiles);
    return result?.count ?? 0;
  }

  async listProviderProfiles(): Promise<ScreenUnderstandingProviderProfile[]> {
    return this.db
      .select()
      .from(screenUnderstandingProviderProfiles)
      .orderBy(asc(screenUnderstandingProviderProfiles.createdAt));
  }

  async getProviderProfile(
    id: string
  ): Promise<ScreenUnderstandingProviderProfile | null> {
    const [row] = await this.db
      .select()
      .from(screenUnderstandingProviderProfiles)
      .where(eq(screenUnderstandingProviderProfiles.id, id));
    return row ?? null;
  }

  async createProviderProfile(
    input: ProviderProfileMetadataInput
  ): Promise<ScreenUnderstandingProviderProfile | null> {
    const now = new Date();
    const [created] = await this.db
      .insert(screenUnderstandingProviderProfiles)
      .values({ ...input, version: 1, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    return created ?? null;
  }

  async updateProviderProfile(
    id: string,
    expectedVersion: number,
    input: ProviderProfileMutableInput
  ): Promise<ScreenUnderstandingProviderProfile | null> {
    const [updated] = await this.db
      .update(screenUnderstandingProviderProfiles)
      .set({
        ...input,
        version: sql`${screenUnderstandingProviderProfiles.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(screenUnderstandingProviderProfiles.id, id),
        eq(screenUnderstandingProviderProfiles.version, expectedVersion)
      ))
      .returning();
    return updated ?? null;
  }

  async deleteProviderProfile(
    id: string,
    expectedVersion: number
  ): Promise<ScreenUnderstandingProviderProfile | null> {
    const [deleted] = await this.db
      .delete(screenUnderstandingProviderProfiles)
      .where(and(
        eq(screenUnderstandingProviderProfiles.id, id),
        eq(screenUnderstandingProviderProfiles.version, expectedVersion)
      ))
      .returning();
    return deleted ?? null;
  }

  async countUnderstandingRequestsBetween(dayStart: Date, dayEnd: Date): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(screenUnderstandingRequests)
      .where(and(
        gt(screenUnderstandingRequests.requestedAt, dayStart),
        lt(screenUnderstandingRequests.requestedAt, dayEnd)
      ));
    return result?.count ?? 0;
  }

  async costUnderstandingRequestsBetween(dayStart: Date, dayEnd: Date): Promise<number> {
    const [result] = await this.db
      .select({ cost: sql<number>`coalesce(sum(${screenUnderstandingRequests.costMicros}), 0)::int` })
      .from(screenUnderstandingRequests)
      .where(and(
        gt(screenUnderstandingRequests.requestedAt, dayStart),
        lt(screenUnderstandingRequests.requestedAt, dayEnd)
      ));
    return result?.cost ?? 0;
  }

  async createUnderstandingRequest(input: {
    id: string;
    requestedAt: Date;
    providerProfileId: string;
  }): Promise<void> {
    await this.db.insert(screenUnderstandingRequests).values({
      ...input,
      status: "started",
      costMicros: 0,
    });
  }

  async completeUnderstandingRequest(
    id: string,
    status: "succeeded" | "failed",
    completedAt: Date,
    costMicros: number | null
  ): Promise<void> {
    await this.db
      .update(screenUnderstandingRequests)
      .set({
        status,
        completedAt,
        ...(costMicros == null ? {} : { costMicros }),
      })
      .where(eq(screenUnderstandingRequests.id, id));
  }

  async createUnderstandingObservation(input: {
    id: string;
    capturedAt: Date;
    completedAt: Date;
    providerProfileId: string;
    model: string;
    summary: string;
    activity: string;
    confidence: number;
    sensitive: boolean;
    apps: string[];
    latencyMs: number;
    costMicros: number | null;
  }): Promise<ScreenUnderstandingObservation> {
    const [inserted] = await this.db
      .insert(screenUnderstandingObservations)
      .values(input)
      .returning();
    if (!inserted) throw new Error("screen understanding observation was not written");
    return inserted;
  }

  async latestUnderstandingObservation(): Promise<ScreenUnderstandingObservation | null> {
    const [row] = await this.db
      .select()
      .from(screenUnderstandingObservations)
      .orderBy(desc(screenUnderstandingObservations.capturedAt))
      .limit(1);
    return row ?? null;
  }

  async listUnderstandingObservations(limit: number): Promise<ScreenUnderstandingObservation[]> {
    return this.db
      .select()
      .from(screenUnderstandingObservations)
      .orderBy(desc(screenUnderstandingObservations.capturedAt))
      .limit(limit);
  }

  private async ensureUnderstandingSettings(): Promise<void> {
    await this.db
      .insert(screenUnderstandingSettings)
      .values({
        id: "default",
        ...DEFAULT_UNDERSTANDING_SETTINGS,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  }

  async getUnderstandingSettings(): Promise<ScreenUnderstandingSettings> {
    await this.ensureUnderstandingSettings();
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
    await this.ensureUnderstandingSettings();
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
