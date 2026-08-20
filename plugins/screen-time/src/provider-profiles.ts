import type {
  ScreenUnderstandingProviderProfile,
  ScreenUnderstandingSettings,
} from "./schema.js";
import type {
  ProviderProfileMetadataInput,
  ProviderProfileMutableInput,
} from "./store.js";

export const PROVIDER_PROFILE_LIMIT = 20;
export const PROVIDER_PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MAX_VERSION = 2_147_483_647;

export type ProviderErrorCode =
  | "PROVIDER_PROFILE_NOT_FOUND"
  | "PROVIDER_PROFILE_CONFLICT"
  | "PROVIDER_PROFILE_IN_USE"
  | "PROVIDER_PROFILE_LIMIT"
  | "PROVIDER_KEY_REQUIRED"
  | "KEYCHAIN_UNAVAILABLE"
  | "KEYCHAIN_OPERATION_FAILED"
  | "PLUGIN_TIMEOUT";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly currentVersion?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderProfileStore {
  countProviderProfiles(): Promise<number>;
  listProviderProfiles(): Promise<ScreenUnderstandingProviderProfile[]>;
  getProviderProfile(id: string): Promise<ScreenUnderstandingProviderProfile | null>;
  createProviderProfile(
    input: ProviderProfileMetadataInput
  ): Promise<ScreenUnderstandingProviderProfile | null>;
  updateProviderProfile(
    id: string,
    expectedVersion: number,
    input: ProviderProfileMutableInput
  ): Promise<ScreenUnderstandingProviderProfile | null>;
  deleteProviderProfile(
    id: string,
    expectedVersion: number
  ): Promise<ScreenUnderstandingProviderProfile | null>;
  getUnderstandingSettings(): Promise<ScreenUnderstandingSettings>;
}

export interface ProviderSecretStore {
  has(id: string, signal?: AbortSignal): Promise<boolean>;
  get?(id: string, signal?: AbortSignal): Promise<string | null>;
  set(id: string, value: string, signal?: AbortSignal): Promise<void>;
  delete(id: string, signal?: AbortSignal): Promise<void>;
}

export interface ProviderProfile {
  id: string;
  version: number;
  displayName: string;
  providerKind: "openai-compatible";
  baseUrl: string;
  model: string;
  hasApiKey: boolean | null;
  createdAt: string;
  updatedAt: string;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function objectWithExactKeys(
  body: unknown,
  allowed: readonly string[]
): ValidationResult<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) return { ok: false, error: `unknown provider field: ${unknown}` };
  const missing = allowed.find((key) => !Object.hasOwn(input, key));
  if (missing) return { ok: false, error: `missing provider field: ${missing}` };
  return { ok: true, value: input };
}

function normalizeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    const protocolAllowed = parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname));
    if (
      !protocolAllowed ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) return null;
    parsed.pathname = parsed.pathname === "/"
      ? ""
      : parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function validateMutable(
  input: Record<string, unknown>
): ValidationResult<ProviderProfileMutableInput> {
  if (
    typeof input.displayName !== "string" ||
    input.displayName.trim().length < 1 ||
    input.displayName.trim().length > 80
  ) return { ok: false, error: "displayName must be 1 to 80 characters" };
  if (input.providerKind !== "openai-compatible") {
    return { ok: false, error: "providerKind must be openai-compatible" };
  }
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      error: "baseUrl must be HTTPS or HTTP loopback without credentials, query, or fragment",
    };
  }
  if (
    typeof input.model !== "string" ||
    input.model.trim().length < 1 ||
    input.model.trim().length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.model)
  ) return { ok: false, error: "model must be 1 to 200 characters without control characters" };
  return {
    ok: true,
    value: {
      displayName: input.displayName.trim(),
      providerKind: "openai-compatible",
      baseUrl,
      model: input.model.trim(),
    },
  };
}

const CREATE_KEYS = ["id", "displayName", "providerKind", "baseUrl", "model"] as const;
const UPDATE_KEYS = ["expectedVersion", "displayName", "providerKind", "baseUrl", "model"] as const;

export function validateProviderCreate(
  body: unknown
): ValidationResult<ProviderProfileMetadataInput> {
  const object = objectWithExactKeys(body, CREATE_KEYS);
  if (!object.ok) return object;
  const id = typeof object.value.id === "string" ? object.value.id.trim() : "";
  if (!PROVIDER_PROFILE_ID_RE.test(id)) {
    return { ok: false, error: "id must be a valid identifier up to 100 characters" };
  }
  const mutable = validateMutable(object.value);
  return mutable.ok ? { ok: true, value: { id, ...mutable.value } } : mutable;
}

export function validateProviderUpdate(
  body: unknown
): ValidationResult<{ expectedVersion: number } & ProviderProfileMutableInput> {
  const object = objectWithExactKeys(body, UPDATE_KEYS);
  if (!object.ok) return object;
  if (
    !Number.isInteger(object.value.expectedVersion) ||
    Number(object.value.expectedVersion) < 1 ||
    Number(object.value.expectedVersion) > MAX_VERSION
  ) return { ok: false, error: `expectedVersion must be an integer from 1 to ${MAX_VERSION}` };
  const mutable = validateMutable(object.value);
  return mutable.ok
    ? { ok: true, value: { expectedVersion: Number(object.value.expectedVersion), ...mutable.value } }
    : mutable;
}

export function validateProviderDelete(
  body: unknown
): ValidationResult<{ expectedVersion: number }> {
  const object = objectWithExactKeys(body, ["expectedVersion"]);
  if (!object.ok) return object;
  if (
    !Number.isInteger(object.value.expectedVersion) ||
    Number(object.value.expectedVersion) < 1 ||
    Number(object.value.expectedVersion) > MAX_VERSION
  ) return { ok: false, error: `expectedVersion must be an integer from 1 to ${MAX_VERSION}` };
  return { ok: true, value: { expectedVersion: Number(object.value.expectedVersion) } };
}

export function validateProviderKey(
  body: unknown
): ValidationResult<{ apiKey: string }> {
  const object = objectWithExactKeys(body, ["apiKey"]);
  if (!object.ok) return object;
  const value = object.value.apiKey;
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    value.trim() !== value ||
    /[\u0000\r\n]/.test(value)
  ) return { ok: false, error: "apiKey must be 1 to 4096 bytes without whitespace padding or line breaks" };
  return { ok: true, value: { apiKey: value } };
}

function serializeProfile(
  row: ScreenUnderstandingProviderProfile,
  hasApiKey: boolean | null
): ProviderProfile {
  return {
    id: row.id,
    version: row.version,
    displayName: row.displayName,
    providerKind: "openai-compatible",
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class ProviderProfileService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly store: ProviderProfileStore,
    private readonly secrets: ProviderSecretStore
  ) {}

  private async exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.locks.set(id, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  async list(signal?: AbortSignal): Promise<ProviderProfile[]> {
    const rows = await this.store.listProviderProfiles();
    return mapWithConcurrency(rows, 4, async (row) => {
      try {
        return serializeProfile(row, await this.secrets.has(row.id, signal));
      } catch {
        return serializeProfile(row, null);
      }
    });
  }

  async create(input: ProviderProfileMetadataInput): Promise<ProviderProfile> {
    return this.exclusive("$create", async () => {
      if (await this.store.countProviderProfiles() >= PROVIDER_PROFILE_LIMIT) {
        throw new ProviderError("PROVIDER_PROFILE_LIMIT", "provider profile limit reached", 409);
      }
      const created = await this.store.createProviderProfile(input);
      if (!created) {
        throw new ProviderError("PROVIDER_PROFILE_CONFLICT", `provider profile ${input.id} already exists`, 409);
      }
      return serializeProfile(created, false);
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    input: ProviderProfileMutableInput,
    signal?: AbortSignal
  ): Promise<ProviderProfile> {
    return this.exclusive(id, async () => {
      const existing = await this.requireProfile(id);
      if (existing.version !== expectedVersion) {
        throw new ProviderError(
          "PROVIDER_PROFILE_CONFLICT",
          `provider profile ${id} version conflict`,
          409,
          existing.version
        );
      }
      let hasApiKey: boolean | null = null;
      try {
        hasApiKey = await this.secrets.has(id, signal);
      } catch {
        // Metadata remains editable when the native Keychain helper is down.
      }
      const updated = await this.store.updateProviderProfile(id, expectedVersion, input);
      if (!updated) await this.throwMissingOrConflict(id);
      return serializeProfile(updated!, hasApiKey);
    });
  }

  async deleteProfile(id: string, expectedVersion: number, signal?: AbortSignal): Promise<void> {
    await this.exclusive(id, async () => {
      const existing = await this.requireProfile(id);
      if (existing.version !== expectedVersion) {
        throw new ProviderError(
          "PROVIDER_PROFILE_CONFLICT",
          `provider profile ${id} version conflict`,
          409,
          existing.version
        );
      }
      const settings = await this.store.getUnderstandingSettings();
      if (settings.providerProfileId === id) {
        throw new ProviderError("PROVIDER_PROFILE_IN_USE", `provider profile ${id} is selected`, 409);
      }
      await this.secrets.delete(id, signal);
      const deleted = await this.store.deleteProviderProfile(id, expectedVersion);
      if (!deleted) {
        const current = await this.store.getProviderProfile(id);
        throw new ProviderError(
          "PROVIDER_PROFILE_CONFLICT",
          `provider profile ${id} version conflict`,
          409,
          current?.version ?? existing.version
        );
      }
    });
  }

  async setKey(id: string, apiKey: string, signal?: AbortSignal): Promise<{ id: string; hasApiKey: true }> {
    return this.exclusive(id, async () => {
      await this.requireProfile(id);
      await this.secrets.set(id, apiKey, signal);
      return { id, hasApiKey: true };
    });
  }

  async deleteKey(id: string, signal?: AbortSignal): Promise<{ id: string; hasApiKey: false }> {
    return this.exclusive(id, async () => {
      await this.requireProfile(id);
      const settings = await this.store.getUnderstandingSettings();
      if (settings.enabled && settings.providerProfileId === id) {
        throw new ProviderError("PROVIDER_PROFILE_IN_USE", `provider profile ${id} is active`, 409);
      }
      await this.secrets.delete(id, signal);
      return { id, hasApiKey: false };
    });
  }

  async withSelectable<T>(
    id: string,
    requireKey: boolean,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    return this.exclusive(id, async () => {
      await this.requireProfile(id);
      if (requireKey && !(await this.secrets.has(id, signal))) {
        throw new ProviderError("PROVIDER_KEY_REQUIRED", `provider profile ${id} requires an API key`, 409);
      }
      return operation();
    });
  }

  async getForInference(
    id: string,
    signal?: AbortSignal
  ): Promise<{ profile: ProviderProfile; apiKey: string }> {
    return this.exclusive(id, async () => {
      const row = await this.requireProfile(id);
      if (!this.secrets.get) {
        throw new ProviderError(
          "KEYCHAIN_OPERATION_FAILED",
          "Keychain helper cannot read provider credentials",
          503
        );
      }
      const apiKey = await this.secrets.get(id, signal);
      if (!apiKey) {
        throw new ProviderError(
          "PROVIDER_KEY_REQUIRED",
          `provider profile ${id} requires an API key`,
          409
        );
      }
      return {
        profile: serializeProfile(row, true),
        apiKey,
      };
    });
  }

  private async requireProfile(id: string): Promise<ScreenUnderstandingProviderProfile> {
    const row = await this.store.getProviderProfile(id);
    if (!row) {
      throw new ProviderError("PROVIDER_PROFILE_NOT_FOUND", `provider profile ${id} not found`, 404);
    }
    return row;
  }

  private async throwMissingOrConflict(id: string): Promise<never> {
    const current = await this.store.getProviderProfile(id);
    if (!current) {
      throw new ProviderError("PROVIDER_PROFILE_NOT_FOUND", `provider profile ${id} not found`, 404);
    }
    throw new ProviderError(
      "PROVIDER_PROFILE_CONFLICT",
      `provider profile ${id} version conflict`,
      409,
      current.version
    );
  }
}
