import type {
  ScreenUnderstandingSettings,
} from "./schema.js";

export interface UnderstandingSettingsInput {
  enabled: boolean;
  captureIntervalSeconds: number;
  captureDisplay: "active";
  skipWhenIdle: boolean;
  providerProfileId: string | null;
  requestTimeoutMs: number;
  maxConcurrency: number;
  maxAttempts: number;
  dailyRequestBudget: number;
  dailyCostBudgetMicros: number;
  remoteConsentOrigin: string | null;
}

export interface UnderstandingSettingsUpdate extends UnderstandingSettingsInput {
  expectedVersion: number;
}

export const DEFAULT_UNDERSTANDING_SETTINGS: UnderstandingSettingsInput = {
  enabled: false,
  captureIntervalSeconds: 60,
  captureDisplay: "active",
  skipWhenIdle: true,
  providerProfileId: null,
  requestTimeoutMs: 30_000,
  maxConcurrency: 1,
  maxAttempts: 3,
  dailyRequestBudget: 480,
  dailyCostBudgetMicros: 0,
  remoteConsentOrigin: null,
};

const UPDATE_KEYS = new Set([
  "expectedVersion",
  ...Object.keys(DEFAULT_UNDERSTANDING_SETTINGS),
]);

type ValidationResult =
  | { ok: true; value: UnderstandingSettingsUpdate }
  | { ok: false; error: string };

function integerInRange(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): string | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? null
    : `${name} must be an integer from ${minimum} to ${maximum}`;
}

const PROVIDER_PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const HTTP_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function normalizeProviderProfileId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return PROVIDER_PROFILE_ID_RE.test(normalized) ? normalized : undefined;
}

function normalizeOrigin(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = new URL(value);
    const permittedProtocol = parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && HTTP_LOOPBACK_HOSTS.has(parsed.hostname));
    if (!permittedProtocol) return undefined;
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function validateUnderstandingSettingsUpdate(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !UPDATE_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, error: `unknown settings field: ${unknown[0]}` };
  }
  const required = [...UPDATE_KEYS].filter((key) => !Object.hasOwn(input, key));
  if (required.length > 0) {
    return { ok: false, error: `missing settings field: ${required[0]}` };
  }
  if (typeof input.enabled !== "boolean" || typeof input.skipWhenIdle !== "boolean") {
    return { ok: false, error: "enabled and skipWhenIdle must be booleans" };
  }
  if (input.captureDisplay !== "active") {
    return { ok: false, error: "captureDisplay must be active" };
  }
  const integerChecks: Array<[unknown, string, number, number]> = [
    [input.expectedVersion, "expectedVersion", 1, 2_147_483_647],
    [input.captureIntervalSeconds, "captureIntervalSeconds", 60, 3_600],
    [input.requestTimeoutMs, "requestTimeoutMs", 1_000, 120_000],
    [input.maxConcurrency, "maxConcurrency", 1, 8],
    [input.maxAttempts, "maxAttempts", 1, 10],
    [input.dailyRequestBudget, "dailyRequestBudget", 1, 1_440],
    [input.dailyCostBudgetMicros, "dailyCostBudgetMicros", 0, 2_000_000_000],
  ];
  for (const check of integerChecks) {
    const error = integerInRange(...check);
    if (error) return { ok: false, error };
  }
  const providerProfileId = normalizeProviderProfileId(input.providerProfileId);
  if (providerProfileId === undefined) {
    return {
      ok: false,
      error: "providerProfileId must be null or an identifier up to 100 characters",
    };
  }
  const origin = normalizeOrigin(input.remoteConsentOrigin);
  if (origin === undefined) {
    return {
      ok: false,
      error: "remoteConsentOrigin must be null, an HTTPS origin, or an HTTP loopback origin without credentials, path, query, or fragment",
    };
  }
  return {
    ok: true,
    value: {
      expectedVersion: Number(input.expectedVersion),
      enabled: input.enabled,
      captureIntervalSeconds: Number(input.captureIntervalSeconds),
      captureDisplay: "active",
      skipWhenIdle: input.skipWhenIdle,
      providerProfileId,
      requestTimeoutMs: Number(input.requestTimeoutMs),
      maxConcurrency: Number(input.maxConcurrency),
      maxAttempts: Number(input.maxAttempts),
      dailyRequestBudget: Number(input.dailyRequestBudget),
      dailyCostBudgetMicros: Number(input.dailyCostBudgetMicros),
      remoteConsentOrigin: origin,
    },
  };
}

export interface UnderstandingSettingsStore {
  getUnderstandingSettings(): Promise<ScreenUnderstandingSettings>;
  updateUnderstandingSettings(
    expectedVersion: number,
    input: UnderstandingSettingsInput
  ): Promise<ScreenUnderstandingSettings | null>;
}

export type UnderstandingSettingsUpdateResult =
  | { ok: true; settings: ScreenUnderstandingSettings }
  | { ok: false; currentVersion: number };

export class UnderstandingSettingsService {
  constructor(private readonly store: UnderstandingSettingsStore) {}

  async get(): Promise<ScreenUnderstandingSettings> {
    return this.store.getUnderstandingSettings();
  }

  async update(
    expectedVersion: number,
    input: UnderstandingSettingsInput
  ): Promise<UnderstandingSettingsUpdateResult> {
    const updated = await this.store.updateUnderstandingSettings(expectedVersion, input);
    if (!updated) {
      const current = await this.store.getUnderstandingSettings();
      return { ok: false, currentVersion: current.version };
    }
    return { ok: true, settings: updated };
  }
}
