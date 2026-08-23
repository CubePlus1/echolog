export type InspirationStatus = "inbox" | "kept" | "archived";

export interface Inspiration {
  id: string;
  version: number;
  content: string;
  tags: string[];
  project: string | null;
  status: InspirationStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  lastSurfacedAt: Date | null;
}

export interface CreateInspirationInput {
  content: string;
  tags: string[];
  project: string | null;
  status: Exclude<InspirationStatus, "archived">;
}

export interface UpdateInspirationInput {
  expectedVersion: number;
  content?: string;
  tags?: string[];
  project?: string | null;
  status?: Exclude<InspirationStatus, "archived">;
}

export interface InspirationListFilter {
  text?: string;
  tags?: string[];
  project?: string;
  statuses?: InspirationStatus[];
  includeArchived?: boolean;
  limit: number;
  before?: Date;
}

export type FlowSource = "manual" | "scheduled";
export type FlowDeliveryStatus = "reserved" | "sent" | "failed" | "acted";
export type FlowOutcome =
  | "viewed"
  | "continued"
  | "kept"
  | "later"
  | "archived";

export interface FlowSettings {
  id: "default";
  version: number;
  enabled: boolean;
  intervalMinutes: number;
  quietStartMinute: number;
  quietEndMinute: number;
  cooldownMinutes: number;
  dailyLimit: number;
  defaultSnoozeMinutes: number;
  statuses: Array<Exclude<InspirationStatus, "archived">>;
  tags: string[];
  projects: string[];
  updatedAt: Date;
}

export interface FlowSettingsUpdate {
  expectedVersion: number;
  enabled: boolean;
  intervalMinutes: number;
  quietStartMinute: number;
  quietEndMinute: number;
  cooldownMinutes: number;
  dailyLimit: number;
  defaultSnoozeMinutes: number;
  statuses: Array<Exclude<InspirationStatus, "archived">>;
  tags: string[];
  projects: string[];
}

export interface FlowDelivery {
  id: string;
  version: number;
  attempts: number;
  inspirationId: string;
  source: FlowSource;
  dedupeKey: string;
  status: FlowDeliveryStatus;
  outcome: FlowOutcome | null;
  surfacedAt: Date;
  notifiedAt: Date | null;
  snoozedUntil: Date | null;
  outcomeAt: Date | null;
  notificationChannel: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlowCandidate {
  inspiration: Inspiration;
  delivery: FlowDelivery;
  explanation: string[];
  duplicate: boolean;
}

export interface FlowOutcomeInput {
  expectedDeliveryVersion: number;
  expectedInspirationVersion: number;
  outcome: FlowOutcome;
  snoozeMinutes?: number;
}

export interface DailyInspirationSummary {
  captured: number;
  surfaced: number;
  outcomes: Partial<Record<FlowOutcome, number>>;
}
