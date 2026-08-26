import type {
  PluginCommandRequest,
  PluginCommandResult,
} from "@echolog/plugin-sdk";
import {
  ProviderError,
  type ProviderSecretStore,
} from "./provider-profiles.js";
import {
  checkMacosHelperInstall,
  resolveMacosHelperExecutable,
} from "./macos-helper.js";

export const SCREEN_UNDERSTANDING_KEYCHAIN_SERVICE =
  "com.cubeplus1.echolog.screen-understanding";

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

function parseResponse(
  result: PluginCommandResult,
  expectedSecretState: boolean | null
): boolean {
  if (result.exitCode !== 0) {
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
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
    throw new ProviderError("KEYCHAIN_OPERATION_FAILED", "Keychain operation failed", 502);
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

  constructor(
    private readonly exec: KeychainCommandAdapter,
    executableOverride?: string
  ) {
    this.executable = resolveMacosHelperExecutable(executableOverride);
  }

  async has(id: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const result = await this.run("status", id, undefined, signal);
      return parseResponse(result, null);
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
        signal
      );
      parseResponse(result, true);
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  async get(id: string, signal?: AbortSignal): Promise<string | null> {
    try {
      return parseSecret(await this.run("get", id, undefined, signal));
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  async delete(id: string, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.run("delete", id, undefined, signal);
      parseResponse(result, false);
    } catch (error) {
      throw helperFailure(error, this.executable);
    }
  }

  private run(
    operation: "status" | "get" | "set" | "delete",
    id: string,
    stdin: string | undefined,
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
        "--json",
      ],
      timeoutMs: 5_000,
      maxBufferBytes: 16 * 1024,
      ...(stdin === undefined ? {} : { stdin }),
    }, signal);
  }
}
