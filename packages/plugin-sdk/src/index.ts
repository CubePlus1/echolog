export const PLUGIN_API_VERSION = "1" as const;

export type PluginState =
  | "disabled"
  | "validating"
  | "migrating"
  | "starting"
  | "ready"
  | "degraded"
  | "stopping";

export type PluginErrorCode =
  | "PLUGIN_DISABLED"
  | "PLUGIN_DEGRADED"
  | "PLUGIN_API_INCOMPATIBLE"
  | "PLUGIN_DEPENDENCY_MISSING"
  | "PLUGIN_EXEC_FAILED"
  | "PLUGIN_TIMEOUT"
  | "PLUGIN_OUTPUT_INVALID";

export interface PluginManifest {
  manifestVersion: 1;
  id: string;
  version: string;
  apiVersion: string;
  displayName: string;
  description: string;
  entries: {
    server?: string;
    cli?: string;
    web?: string;
  };
  capabilities: string[];
  permissions: string[];
  requires: {
    coreApi: string;
    platforms?: string[];
    executables?: string[];
  };
  configSchema?: string;
}

export interface PluginMigration {
  name: string;
  sql: string;
}

export type PluginHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PluginHttpRequest {
  params: Record<string, string>;
  query: unknown;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface PluginHttpResponse {
  statusCode?: number;
  body: unknown;
}

export interface PluginRoute {
  method: PluginHttpMethod;
  path: string;
  compatibilityAlias?: boolean;
  handler(
    request: PluginHttpRequest,
    signal: AbortSignal
  ): Promise<unknown | PluginHttpResponse>;
}

export interface PluginJob {
  id: string;
  intervalMs: number;
  timeoutMs?: number;
  run(signal: AbortSignal): Promise<void>;
}

export interface PluginReportSection {
  id: string;
  title: string;
  order?: number;
  timeoutMs?: number;
  render(date: string, signal: AbortSignal): Promise<string | null>;
}

export interface PluginCommandRequest {
  executable: string;
  args: string[];
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
}

export interface PluginCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PluginLogger {
  debug(fields: unknown, message?: string): void;
  info(fields: unknown, message?: string): void;
  warn(fields: unknown, message?: string): void;
  error(fields: unknown, message?: string): void;
}

export interface PluginDoctorCheck {
  id: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface PluginContext {
  readonly pluginId: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly logger: PluginLogger;
  registerRoute(route: PluginRoute): void;
  registerJob(job: PluginJob): void;
  registerReportSection(section: PluginReportSection): void;
  exec(request: PluginCommandRequest, signal?: AbortSignal): Promise<PluginCommandResult>;
  service<T>(name: string): T;
}

export interface PluginDefinition {
  manifest: PluginManifest;
  routes?: PluginRoute[];
  defaultEnabled?: boolean;
  defaultConfig?: Record<string, unknown>;
  normalizeConfig?(
    config: Record<string, unknown>
  ): Record<string, unknown>;
  validateConfig?(config: Readonly<Record<string, unknown>>): string[];
  migrations?: PluginMigration[];
  register?(context: PluginContext): Promise<void> | void;
  start?(context: PluginContext): Promise<void> | void;
  stop?(context: PluginContext, signal: AbortSignal): Promise<void> | void;
  doctor?(context: PluginContext): Promise<PluginDoctorCheck[]>;
}

export interface PluginRuntimeInfo {
  id: string;
  displayName: string;
  version: string;
  apiVersion: string;
  configured: boolean;
  enabled: boolean;
  state: PluginState;
  capabilities: string[];
  permissions: string[];
  webEntry?: string;
  error?: {
    code: PluginErrorCode;
    message: string;
  };
  failureCount: number;
  lastErrorAt?: string;
}

export class PluginError extends Error {
  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly pluginId: string,
    public readonly state: PluginState,
    public readonly statusCode = 503,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PluginError";
  }
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validatePluginManifest(manifest: PluginManifest): string[] {
  const errors: string[] = [];
  if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1");
  if (!ID_RE.test(manifest.id) || manifest.id.length > 64) {
    errors.push("id must be lowercase kebab-case and at most 64 characters");
  }
  if (!VERSION_RE.test(manifest.version)) errors.push("version must be semver");
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    errors.push(`apiVersion must be ${PLUGIN_API_VERSION}`);
  }
  if (!manifest.displayName?.trim()) errors.push("displayName is required");
  if (!manifest.description?.trim()) errors.push("description is required");
  if (!manifest.requires?.coreApi?.trim()) errors.push("requires.coreApi is required");
  for (const [name, values] of [
    ["capabilities", manifest.capabilities],
    ["permissions", manifest.permissions],
  ] as const) {
    if (!Array.isArray(values)) {
      errors.push(`${name} must be an array`);
    } else if (new Set(values).size !== values.length) {
      errors.push(`${name} must not contain duplicates`);
    }
  }
  return errors;
}

export function isPluginHttpResponse(value: unknown): value is PluginHttpResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      "body" in value &&
      (!("statusCode" in value) ||
        typeof (value as PluginHttpResponse).statusCode === "number")
  );
}
