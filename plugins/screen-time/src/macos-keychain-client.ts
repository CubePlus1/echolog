import type {
  PluginCommandRequest,
  PluginCommandResult,
} from "@echolog/plugin-sdk";
import {
  ProviderError,
  type ProviderSecretAccess,
  type ProviderSecretStore,
} from "./provider-profiles.js";
import {
  checkMacosHelperInstall,
  resolveMacosHelperExecutable,
} from "./macos-helper.js";

export const SCREEN_UNDERSTANDING_KEYCHAIN_SERVICE =
  "com.cubeplus1.echolog.screen-understanding";
export const INTERACTIVE_KEYCHAIN_TIMEOUT_MS = 60_000;
export const NON_INTERACTIVE_KEYCHAIN_TIMEOUT_MS = 5_000;

export type KeychainCommandAdapter = (
  request: PluginCommandRequest,
  signal?: AbortSignal
) => Promise<PluginCommandResult>;

function helperFailure(error: unknown, executable: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  if (
    candidate?.name === "AbortError" ||
    candidate?.code === "ABORT_ERR" ||
    candidate?.code === "ETIMEDOUT" ||
    (candidate?.killed === true && candidate?.signal !== undefined)
  ) {
    return new ProviderError("PLUGIN_TIMEOUT", "Keychain helper timed out", 504);
  }
  if (candidate?.code === "ENOENT") {
    const check = checkMacosHelperInstall(executable);
    return new ProviderError(
      "KEYCHAIN_UNAVAILABLE",
      check.ok ? `Keychain helper could not be launched at ${executable}` : check.message,
      503
    );
  }
  return new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
}

function helperResultFailure(result: PluginCommandResult): ProviderError {
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
  }
  const object = value as Record<string, unknown>;
  if (object.ok !== false || typeof object.code !== "string") {
    return new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
  }
  if (object.code === "KEYCHAIN_AUTH_REQUIRED") {
    return new ProviderError(
      "KEYCHAIN_AUTH_REQUIRED",
      "Keychain authorization is required",
      409
    );
  }
  if (object.code === "KEYCHAIN_UNAVAILABLE") {
    return new ProviderError("KEYCHAIN_UNAVAILABLE", "Keychain is unavailable", 503);
  }
  return new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
}

function parseResponse(
  result: PluginCommandResult,
  expectedSecretState: boolean | null
): boolean {
  if (result.exitCode !== 0) {
    throw helperResultFailure(result);
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).length !== 2 ||
    object.ok !== true ||
    typeof object.hasSecret !== "boolean" ||
    (expectedSecretState !== null && object.hasSecret !== expectedSecretState)
  ) {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  return object.hasSecret;
}

function parseSecret(result: PluginCommandResult): string | null {
  if (result.exitCode !== 0) {
    throw helperResultFailure(result);
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  const object = value as Record<string, unknown>;
  if (object.ok !== true || typeof object.hasSecret !== "boolean") {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  if (!object.hasSecret) {
    if (Object.keys(object).length !== 2) {
      throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
    }
    return null;
  }
  if (
    Object.keys(object).length !== 3 ||
    typeof object.secret !== "string" ||
    object.secret.length === 0 ||
    Buffer.byteLength(object.secret, "utf8") > 4096 ||
    object.secret.trim() !== object.secret ||
    /[\u0000\r\n]/.test(object.secret)
  ) {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain helper returned invalid output", 502);
  }
  return object.secret;
}

export class MacKeychainClient implements ProviderSecretStore {
  private readonly executable: string;
  private readonly cache = new Map<string, string>();
  private readonly knownSecretState = new Map<string, boolean>();

  constructor(
    private readonly exec: KeychainCommandAdapter,
    executableOverride?: string
  ) {
    this.executable = resolveMacosHelperExecutable(executableOverride);
  }

  cachedState(id: string): boolean | null {
    if (this.cache.has(id)) return true;
    return this.knownSecretState.get(id) ?? null;
  }

  hasCachedValue(id: string): boolean {
    return this.cache.has(id);
  }

  clearCache(): void {
    this.cache.clear();
    this.knownSecretState.clear();
  }

  async has(
    id: string,
    signal?: AbortSignal,
    access: ProviderSecretAccess = "non-interactive"
  ): Promise<boolean> {
    const cached = this.cachedState(id);
    if (cached !== null) return cached;
    try {
      const result = await this.run("status", id, undefined, access, signal);
      const hasSecret = parseResponse(result, null);
      this.knownSecretState.set(id, hasSecret);
      return hasSecret;
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  async set(id: string, value: string, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.run(
        "set",
        id,
        JSON.stringify({ secret: value }),
        "interactive",
        signal
      );
      parseResponse(result, true);
      this.cache.set(id, value);
      this.knownSecretState.set(id, true);
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  async get(
    id: string,
    signal?: AbortSignal,
    access: ProviderSecretAccess = "interactive"
  ): Promise<string | null> {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    if (access === "non-interactive" && this.knownSecretState.get(id) === false) {
      return null;
    }
    try {
      const secret = parseSecret(await this.run("get", id, undefined, access, signal));
      if (secret === null) {
        this.knownSecretState.set(id, false);
      } else {
        this.cache.set(id, secret);
        this.knownSecretState.set(id, true);
      }
      return secret;
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  async delete(id: string, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.run("delete", id, undefined, "interactive", signal);
      parseResponse(result, false);
      this.cache.delete(id);
      this.knownSecretState.set(id, false);
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  private run(
    operation: "status" | "get" | "set" | "delete",
    id: string,
    stdin: string | undefined,
    access: ProviderSecretAccess,
    signal?: AbortSignal
  ): Promise<PluginCommandResult> {
    const check = checkMacosHelperInstall(this.executable);
    if (!check.ok) {
      return Promise.reject(new ProviderError(
        "KEYCHAIN_UNAVAILABLE",
        check.message,
        503
      ));
    }
    return this.exec({
      executable: this.executable,
      args: [
        "keychain",
        operation,
        "--service",
        SCREEN_UNDERSTANDING_KEYCHAIN_SERVICE,
        "--account",
        id,
        ...(access === "non-interactive" && (operation === "status" || operation === "get")
          ? ["--no-auth-ui"]
          : []),
        "--json",
      ],
      timeoutMs: access === "interactive"
        ? INTERACTIVE_KEYCHAIN_TIMEOUT_MS
        : NON_INTERACTIVE_KEYCHAIN_TIMEOUT_MS,
      maxBufferBytes: 16 * 1024,
      ...(stdin === undefined ? {} : { stdin }),
    }, signal);
  }
}
