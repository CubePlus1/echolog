import { readFileSync } from "fs";
import { parse } from "yaml";
import { join } from "path";

export interface Config {
  server: { port: number; host: string };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  sync: { target: string; auto: boolean };
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
  const configPath = join(process.cwd(), "config.yaml");
  const raw = readFileSync(configPath, "utf-8");
  cached = parse(raw) as Config;
  return cached;
}

export function getDbUrl(cfg?: Config): string {
  const c = cfg ?? loadConfig();
  return `postgres://${c.database.user}:${c.database.password}@${c.database.host}:${c.database.port}/${c.database.name}`;
}
