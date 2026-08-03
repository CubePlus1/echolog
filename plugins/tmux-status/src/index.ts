import type {
  PluginDefinition,
  PluginManifest,
} from "@echolog/plugin-sdk";
import manifestJson from "../echolog.plugin.json";
import { TmuxStatusAdapter } from "./adapter.js";
import { createTmuxRoutes, type TmuxServices } from "./routes.js";
import { TmuxObservationStore } from "./store.js";
import type { TmuxAdapterConfig } from "./types.js";

const manifest = manifestJson as PluginManifest;
let currentServices: TmuxServices | null = null;

function services(): TmuxServices {
  if (!currentServices) throw new Error("tmux-status is not initialized");
  return currentServices;
}

function numberConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number
): number {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function adapterConfig(
  config: Readonly<Record<string, unknown>>
): TmuxAdapterConfig {
  return {
    executable:
      typeof config.executable === "string" ? config.executable : "tmux-status",
    timeoutMs: numberConfig(config, "timeout_ms", 5_000),
    collectionIntervalSeconds: numberConfig(
      config,
      "collection_interval_seconds",
      60
    ),
    cpuThreshold: numberConfig(config, "cpu_threshold", 80),
    memoryThresholdMb: numberConfig(config, "memory_threshold_mb", 1_024),
  };
}

function normalizeConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const value = adapterConfig(config);
  return {
    executable: value.executable,
    timeout_ms: value.timeoutMs,
    collection_interval_seconds: value.collectionIntervalSeconds,
    cpu_threshold: value.cpuThreshold,
    memory_threshold_mb: value.memoryThresholdMb,
  };
}

export const tmuxStatusPlugin: PluginDefinition = {
  manifest,
  routes: createTmuxRoutes(services),
  defaultEnabled: false,
  defaultConfig: {
    executable: "tmux-status",
    timeout_ms: 5_000,
    collection_interval_seconds: 60,
    cpu_threshold: 80,
    memory_threshold_mb: 1_024,
  },
  normalizeConfig,
  validateConfig(config) {
    const value = adapterConfig(config);
    const errors: string[] = [];
    if (!value.executable.trim()) errors.push("executable must not be empty");
    if (
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs < 250 ||
      value.timeoutMs > 60_000
    ) {
      errors.push("timeout_ms must be an integer from 250 to 60000");
    }
    if (
      !Number.isInteger(value.collectionIntervalSeconds) ||
      value.collectionIntervalSeconds < 5 ||
      value.collectionIntervalSeconds > 3_600
    ) {
      errors.push(
        "collection_interval_seconds must be an integer from 5 to 3600"
      );
    }
    if (value.cpuThreshold < 0) errors.push("cpu_threshold must be non-negative");
    if (value.memoryThresholdMb < 0) {
      errors.push("memory_threshold_mb must be non-negative");
    }
    return errors;
  },
  migrations: [
    {
      name: "001_tmux_observations",
      sql: `
        CREATE TABLE IF NOT EXISTS tmux_sessions (
          session_key TEXT PRIMARY KEY,
          session_name TEXT NOT NULL,
          session_id TEXT,
          session_created BIGINT,
          first_observed_at TIMESTAMPTZ NOT NULL,
          last_observed_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tmux_pane_minutes (
          session_key TEXT NOT NULL REFERENCES tmux_sessions(session_key)
            ON DELETE CASCADE,
          pane_identity TEXT NOT NULL,
          minute_bucket TIMESTAMPTZ NOT NULL,
          pane_id TEXT NOT NULL,
          pane_pid INTEGER NOT NULL,
          window_id TEXT,
          target TEXT NOT NULL,
          tools TEXT[] NOT NULL DEFAULT '{}'::text[],
          first_observed_at TIMESTAMPTZ NOT NULL,
          last_observed_at TIMESTAMPTZ NOT NULL,
          last_generated_at TIMESTAMPTZ NOT NULL,
          sample_count INTEGER NOT NULL DEFAULT 1,
          cpu_average DOUBLE PRECISION NOT NULL DEFAULT 0,
          cpu_peak DOUBLE PRECISION NOT NULL DEFAULT 0,
          memory_peak_mb DOUBLE PRECISION NOT NULL DEFAULT 0,
          anomaly_count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (session_key, pane_identity, minute_bucket)
        );
        CREATE INDEX IF NOT EXISTS idx_tmux_pane_minutes_bucket
          ON tmux_pane_minutes(minute_bucket);
      `,
    },
  ],
  register(context) {
    const config = adapterConfig(context.config);
    currentServices = {
      adapter: new TmuxStatusAdapter(context, config),
      store: new TmuxObservationStore(
        context.service<string>("database.url")
      ),
    };
    context.registerJob({
      id: "collect-status",
      intervalMs: config.collectionIntervalSeconds * 1_000,
      timeoutMs: config.timeoutMs + 1_000,
      async run(signal) {
        const snapshot = await services().adapter.status(signal);
        await services().store.observe(snapshot);
      },
    });
  },
  start(context) {
    context.logger.info(
      { executable: services().adapter.config.executable },
      "tmux-status plugin started"
    );
  },
  async stop() {
    await currentServices?.store.close();
    currentServices = null;
  },
  async doctor() {
    return (await services().adapter.doctor()).checks;
  },
};

export default tmuxStatusPlugin;
