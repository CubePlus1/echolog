import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { join, dirname } from "path";
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

export function loadConfig(): Config {
  if (cached) return cached;
  const cwdPath = join(process.cwd(), "config.yaml");
  const rootPath = join(PROJECT_ROOT, "config.yaml");
  const configPath = existsSync(cwdPath) ? cwdPath : rootPath;
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as Config;
  parsed.server.serveWeb = parsed.server.serveWeb ?? true;
  cached = parsed;
  return cached;
}

export function getDbUrl(cfg?: Config): string {
  const c = cfg ?? loadConfig();
  return `postgres://${c.database.user}:${c.database.password}@${c.database.host}:${c.database.port}/${c.database.name}`;
}
