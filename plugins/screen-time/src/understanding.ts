import { nanoid } from "nanoid";
import { setTimeout as delay } from "node:timers/promises";
import type { ScreenUnderstandingObservation } from "./schema.js";
import type { UnderstandingSettingsService } from "./understanding-settings.js";
import {
  ProviderError,
  type ProviderProfile,
  type ProviderSecretAccess,
} from "./provider-profiles.js";
import type { CapturedPng, MacScreenCaptureService } from "./macos-screen-capture.js";
import type { VisionCompletion, VisionProviderClient } from "./vision-provider.js";
import { VisionProviderError } from "./vision-provider.js";

const MAX_HISTORY_LIMIT = 100;
const RETRY_BASE_DELAY_MS = 250;

function isKeychainAccessFailure(error: unknown): boolean {
  return error instanceof ProviderError && [
    "KEYCHAIN_UNAVAILABLE",
    "KEYCHAIN_OPERATION_FAILED",
    "KEYCHAIN_AUTH_REQUIRED",
    "PLUGIN_TIMEOUT",
  ].includes(error.code);
}

function isSilentScheduledCredentialFailure(error: unknown): boolean {
  return error instanceof ProviderError && [
    "KEYCHAIN_AUTH_REQUIRED",
    "PROVIDER_KEY_REQUIRED",
  ].includes(error.code);
}

export interface UnderstandingResult {
  summary: string;
  activity: string;
  confidence: number;
  sensitive: boolean;
  apps: string[];
}

export interface UnderstandingObservation {
  id: string;
  capturedAt: string;
  completedAt: string;
  providerProfileId: string;
  model: string;
  summary: string;
  activity: string;
  confidence: number;
  sensitive: boolean;
  apps: string[];
  latencyMs: number;
  costMicros: number | null;
}

export type UnderstandingErrorCode =
  | "UNDERSTANDING_DISABLED"
  | "UNDERSTANDING_BUSY"
  | "UNDERSTANDING_PROVIDER_REQUIRED"
  | "UNDERSTANDING_REQUEST_BUDGET_EXCEEDED"
  | "UNDERSTANDING_COST_BUDGET_EXCEEDED"
  | "UNDERSTANDING_RESPONSE_INVALID";

export class UnderstandingError extends Error {
  constructor(
    public readonly code: UnderstandingErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "UnderstandingError";
  }
}

export interface UnderstandingStore {
  countUnderstandingRequestsBetween(dayStart: Date, dayEnd: Date): Promise<number>;
  costUnderstandingRequestsBetween(dayStart: Date, dayEnd: Date): Promise<number>;
  createUnderstandingRequest(input: {
    id: string;
    requestedAt: Date;
    providerProfileId: string;
  }): Promise<void>;
  completeUnderstandingRequest(
    id: string,
    status: "succeeded" | "failed",
    completedAt: Date,
    costMicros: number | null
  ): Promise<void>;
  createUnderstandingObservation(input: {
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
  }): Promise<ScreenUnderstandingObservation>;
  latestUnderstandingObservation(): Promise<ScreenUnderstandingObservation | null>;
  listUnderstandingObservations(limit: number): Promise<ScreenUnderstandingObservation[]>;
  deleteUnderstandingObservation(id: string): Promise<boolean>;
}

export interface UnderstandingProviderResolver {
  getForInference(
    id: string,
    signal?: AbortSignal,
    access?: ProviderSecretAccess
  ): Promise<{ profile: ProviderProfile; apiKey: string }>;
  hasCachedCredential?(id: string): boolean;
}

export interface UnderstandingCapture {
  captureForInference(signal?: AbortSignal): Promise<CapturedPng>;
}

export interface UnderstandingIdleState {
  isIdle(): boolean;
}

function localDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function asString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      `vision response field ${field} must be a string`,
      502
    );
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      `vision response field ${field} is invalid`,
      502
    );
  }
  return normalized;
}

function parseJsonContent(content: string): unknown {
  let normalized = content.trim();
  if (normalized.startsWith("```")) {
    const firstLineEnd = normalized.indexOf("\n");
    const lastFence = normalized.lastIndexOf("```");
    if (firstLineEnd <= 0 || lastFence <= firstLineEnd) {
      throw new UnderstandingError(
        "UNDERSTANDING_RESPONSE_INVALID",
        "vision response is not a valid JSON object",
        502
      );
    }
    normalized = normalized.slice(firstLineEnd + 1, lastFence).trim();
  }
  try {
    return JSON.parse(normalized);
  } catch {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      "vision response is not valid JSON",
      502
    );
  }
}

export function parseUnderstandingResult(content: string): UnderstandingResult {
  const value = parseJsonContent(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      "vision response must be a JSON object",
      502
    );
  }
  const object = value as Record<string, unknown>;
  const allowed = new Set(["summary", "activity", "confidence", "sensitive", "apps"]);
  const unknown = Object.keys(object).find((key) => !allowed.has(key));
  if (unknown) {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      `vision response has unknown field ${unknown}`,
      502
    );
  }
  if (
    typeof object.confidence !== "number" ||
    !Number.isFinite(object.confidence) ||
    object.confidence < 0 ||
    object.confidence > 1
  ) {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      "vision response confidence must be a number from 0 to 1",
      502
    );
  }
  if (typeof object.sensitive !== "boolean") {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      "vision response sensitive must be a boolean",
      502
    );
  }
  if (!Array.isArray(object.apps) || object.apps.length > 12) {
    throw new UnderstandingError(
      "UNDERSTANDING_RESPONSE_INVALID",
      "vision response apps must contain at most 12 items",
      502
    );
  }
  const apps = object.apps.map((app) => asString(app, "apps", 80));
  return {
    summary: asString(object.summary, "summary", 500),
    activity: asString(object.activity, "activity", 200),
    confidence: object.confidence,
    sensitive: object.sensitive,
    apps: [...new Set(apps)],
  };
}

function serializeObservation(row: ScreenUnderstandingObservation): UnderstandingObservation {
  return {
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
    providerProfileId: row.providerProfileId,
    model: row.model,
    summary: row.summary,
    activity: row.activity,
    confidence: row.confidence,
    sensitive: row.sensitive,
    apps: row.apps,
    latencyMs: row.latencyMs,
    costMicros: row.costMicros,
  };
}

function cancellationError(): Error {
  return Object.assign(new Error("Screen understanding run was cancelled"), {
    name: "AbortError",
    code: "ABORT_ERR",
  });
}

export class ScreenUnderstandingService {
  private inFlight = false;
  private lastScheduledAt = 0;
  private scheduledKeychainBlockedFor: string | null = null;

  constructor(
    private readonly store: UnderstandingStore,
    private readonly settings: UnderstandingSettingsService,
    private readonly providers: UnderstandingProviderResolver,
    private readonly capture: UnderstandingCapture,
    private readonly client: VisionProviderClient,
    private readonly idleState?: UnderstandingIdleState,
    private readonly now: () => Date = () => new Date()
  ) {}

  async run(
    signal?: AbortSignal,
    options: { scheduled?: boolean } = {}
  ): Promise<UnderstandingObservation> {
    if (this.inFlight) {
      throw new UnderstandingError(
        "UNDERSTANDING_BUSY",
        "A screen understanding run is already in progress",
        409
      );
    }
    this.inFlight = true;
    try {
      const configuration = await this.settings.get();
      if (!configuration.enabled) {
        throw new UnderstandingError(
          "UNDERSTANDING_DISABLED",
          "Screen understanding is disabled",
          409
        );
      }
      if (options.scheduled && configuration.skipWhenIdle && this.idleState?.isIdle()) {
        throw new UnderstandingError(
          "UNDERSTANDING_DISABLED",
          "Screen understanding skipped while idle",
          409
        );
      }
      if (!configuration.providerProfileId) {
        throw new UnderstandingError(
          "UNDERSTANDING_PROVIDER_REQUIRED",
          "Screen understanding requires a provider profile",
          409
        );
      }
      if (signal?.aborted) throw cancellationError();

      const resolved = await this.providers.getForInference(
        configuration.providerProfileId,
        signal,
        options.scheduled ? "non-interactive" : "interactive"
      );
      if (!options.scheduled) this.scheduledKeychainBlockedFor = null;
      const captured = await this.capture.captureForInference(signal);
      const capturedAt = new Date(captured.capturedAt);
      if (!Number.isFinite(capturedAt.getTime())) {
        throw new UnderstandingError(
          "UNDERSTANDING_RESPONSE_INVALID",
          "Screen capture returned an invalid timestamp",
          502
        );
      }
      let completion: VisionCompletion | null = null;
      let parsed: UnderstandingResult | null = null;
      let requestCostMicros: number | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= configuration.maxAttempts; attempt++) {
        if (signal?.aborted) throw cancellationError();
        const current = this.now();
        const bounds = localDayBounds(current);
        const requestCount = await this.store.countUnderstandingRequestsBetween(
          bounds.start,
          bounds.end
        );
        if (requestCount >= configuration.dailyRequestBudget) {
          throw new UnderstandingError(
            "UNDERSTANDING_REQUEST_BUDGET_EXCEEDED",
            "Daily screen understanding request budget reached",
            429
          );
        }
        const knownCost = await this.store.costUnderstandingRequestsBetween(
          bounds.start,
          bounds.end
        );
        if (
          configuration.dailyCostBudgetMicros > 0 &&
          knownCost >= configuration.dailyCostBudgetMicros
        ) {
          throw new UnderstandingError(
            "UNDERSTANDING_COST_BUDGET_EXCEEDED",
            "Daily screen understanding cost budget reached",
            429
          );
        }
        const requestId = nanoid(12);
        await this.store.createUnderstandingRequest({
          id: requestId,
          requestedAt: current,
          providerProfileId: resolved.profile.id,
        });
        try {
          completion = await this.client.complete(
            resolved.profile,
            resolved.apiKey,
            captured.png,
            configuration.requestTimeoutMs,
            signal
          );
          parsed = parseUnderstandingResult(completion.content);
          requestCostMicros = completion.costMicros;
          await this.store.completeUnderstandingRequest(
            requestId,
            "succeeded",
            this.now(),
            requestCostMicros
          );
          if (
            requestCostMicros !== null &&
            configuration.dailyCostBudgetMicros > 0 &&
            knownCost + requestCostMicros > configuration.dailyCostBudgetMicros
          ) {
            throw new UnderstandingError(
              "UNDERSTANDING_COST_BUDGET_EXCEEDED",
              "Daily screen understanding cost budget reached",
              429
            );
          }
          break;
        } catch (error) {
          lastError = error;
          await this.store.completeUnderstandingRequest(
            requestId,
            "failed",
            this.now(),
            error instanceof VisionProviderError ? null : null
          ).catch(() => undefined);
          if (
            !(error instanceof VisionProviderError) ||
            !error.retryable ||
            attempt === configuration.maxAttempts
          ) throw error;
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), undefined, { signal });
        }
      }
      if (!completion || !parsed) {
        throw lastError ?? new Error("screen understanding did not complete");
      }
      const completedAt = this.now();
      const row = await this.store.createUnderstandingObservation({
        id: nanoid(12),
        capturedAt,
        completedAt,
        providerProfileId: resolved.profile.id,
        model: resolved.profile.model,
        ...parsed,
        latencyMs: completion.latencyMs,
        costMicros: requestCostMicros,
      });
      return serializeObservation(row);
    } finally {
      this.inFlight = false;
    }
  }

  async runScheduled(signal?: AbortSignal): Promise<UnderstandingObservation | null> {
    if (this.inFlight) return null;
    const configuration = await this.settings.get();
    if (!configuration.enabled) return null;
    if (
      this.scheduledKeychainBlockedFor !== null &&
      this.scheduledKeychainBlockedFor === configuration.providerProfileId
    ) {
      if (!this.providers.hasCachedCredential?.(this.scheduledKeychainBlockedFor)) {
        return null;
      }
      this.scheduledKeychainBlockedFor = null;
    } else if (this.scheduledKeychainBlockedFor !== null) {
      this.scheduledKeychainBlockedFor = null;
    }
    const now = this.now();
    if (
      this.lastScheduledAt > 0 &&
      now.getTime() - this.lastScheduledAt < configuration.captureIntervalSeconds * 1_000
    ) return null;
    this.lastScheduledAt = now.getTime();
    try {
      return await this.run(signal, { scheduled: true });
    } catch (error) {
      if (
        configuration.providerProfileId &&
        (isKeychainAccessFailure(error) ||
          (error instanceof ProviderError && error.code === "PROVIDER_KEY_REQUIRED"))
      ) {
        this.scheduledKeychainBlockedFor = configuration.providerProfileId;
      }
      if (isSilentScheduledCredentialFailure(error)) return null;
      if (
        error instanceof UnderstandingError &&
        error.code === "UNDERSTANDING_DISABLED"
      ) return null;
      throw error;
    }
  }

  async latest(): Promise<UnderstandingObservation | null> {
    const row = await this.store.latestUnderstandingObservation();
    return row ? serializeObservation(row) : null;
  }

  async history(limit = 20): Promise<UnderstandingObservation[]> {
    const bounded = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.trunc(limit)));
    const rows = await this.store.listUnderstandingObservations(bounded);
    return rows.map(serializeObservation);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.deleteUnderstandingObservation(id);
  }
}
