import { readFileSync } from "fs";
import { parse } from "yaml";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

export interface Config {
  server: {
    port: number;
    host: string;
    apiKey?: string;
    serveWeb?: boolean;
    corsOrigins?: string[];
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  sync: { target: string; auto: boolean };
  tracker?: {
    enabled?: boolean;
    sample_seconds?: number;
    idle_seconds?: number;
  };
  plugins?: Record<
    string,
    {
      enabled?: boolean;
      config?: Record<string, unknown>;
    }
  >;
  notifications: {
    enabled: boolean;
    mac: boolean;
    ntfy: { enabled: boolean; server: string; topic: string };
    rules: {
      task_overtime_minutes: number;
      idle_reminder_enabled: boolean;
      idle_check_start: string;
      idle_check_end: string;
      daily_report_time: string;
      end_of_day_time: string;
    };
  };
}

let cached: Config | null = null;

export function resolveConfigPath(
  explicitPath: string | undefined = process.env.ECHOLOG_CONFIG_PATH
): string {
  return explicitPath?.trim()
    ? resolve(explicitPath)
    : join(PROJECT_ROOT, "config.yaml");
}

export function loadConfig(): Config {
  if (cached) return cached;
  const configPath = resolveConfigPath();
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Config;
  parsed.server.serveWeb = parsed.server.serveWeb ?? true;
  parsed.plugins = parsed.plugins ?? {};
  if (parsed.tracker) {
    const current = parsed.plugins["screen-time"] ?? {};
    parsed.plugins["screen-time"] = {
      enabled: current.enabled ?? parsed.tracker.enabled,
      config: {
        sample_seconds: parsed.tracker.sample_seconds,
        idle_seconds: parsed.tracker.idle_seconds,
        ...(current.config ?? {}),
      },
    };
  }
  cached = parsed;
  return cached;
}

export function getDbUrl(cfg?: Config): string {
  const c = cfg ?? loadConfig();
  return `postgres://${c.database.user}:${c.database.password}@${c.database.host}:${c.database.port}/${c.database.name}`;
}
