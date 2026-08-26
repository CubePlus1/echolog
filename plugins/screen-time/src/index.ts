import type {
  PluginDefinition,
  PluginManifest,
} from "@echolog/plugin-sdk";
import manifestJson from "../echolog.plugin.json";
import { MacKeychainClient } from "./macos-keychain-client.js";
import {
  MacScreenCaptureService,
} from "./macos-screen-capture.js";
import {
  checkMacosHelperInstall,
  validateMacosHelperExecutableOverride,
} from "./macos-helper.js";
import { ProviderProfileService } from "./provider-profiles.js";
import { createScreenRoutes } from "./routes.js";
import { ScreenService } from "./screen.js";
import { ScreenStore } from "./store.js";
import { ScreenTracker } from "./tracker.js";
import { UnderstandingSettingsService } from "./understanding-settings.js";
import { ScreenUnderstandingService } from "./understanding.js";
import { OpenAICompatibleVisionClient } from "./vision-provider.js";

const manifest = manifestJson as PluginManifest;
let store: ScreenStore | null = null;
let tracker: ScreenTracker | null = null;
let service: ScreenService | null = null;
let understandingSettings: UnderstandingSettingsService | null = null;
let providerProfiles: ProviderProfileService | null = null;
let screenCapture: MacScreenCaptureService | null = null;
let screenUnderstanding: ScreenUnderstandingService | null = null;

// Poll frequently enough that a dynamic 120-second setting is not rounded up
// to the next minute-sized scheduler tick.
export const SCREEN_UNDERSTANDING_SCHEDULER_POLL_MS = 5_000;

function requireService(): ScreenService {
  if (!service) throw new Error("screen-time service is not initialized");
  return service;
}

function requireUnderstandingSettings(): UnderstandingSettingsService {
  if (!understandingSettings) {
    throw new Error("screen understanding settings service is not initialized");
  }
  return understandingSettings;
}

function requireProviderProfiles(): ProviderProfileService {
  if (!providerProfiles) {
    throw new Error("screen understanding provider service is not initialized");
  }
  return providerProfiles;
}

function requireScreenCapture(): MacScreenCaptureService {
  if (!screenCapture) {
    throw new Error("screen capture service is not initialized");
  }
  return screenCapture;
}

function requireScreenUnderstanding(): ScreenUnderstandingService {
  if (!screenUnderstanding) {
    throw new Error("screen understanding service is not initialized");
  }
  return screenUnderstanding;
}

function integerConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number
): number {
  const value = config[key];
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}

export const screenTimePlugin: PluginDefinition = {
  manifest,
  routes: createScreenRoutes(
    requireService,
    requireUnderstandingSettings,
    requireProviderProfiles,
    requireScreenCapture,
    requireScreenUnderstanding
  ),
  defaultEnabled: true,
  defaultConfig: {
    sample_seconds: 5,
    idle_seconds: 180,
  },
  normalizeConfig(config) {
    return {
      sample_seconds: integerConfig(config, "sample_seconds", 5),
      idle_seconds: integerConfig(config, "idle_seconds", 180),
      ...(typeof config.macos_helper_path === "string"
        ? { macos_helper_path: config.macos_helper_path }
        : {}),
    };
  },
  validateConfig(config) {
    const errors: string[] = [];
    const sampleSeconds = integerConfig(config, "sample_seconds", 0);
    const idleSeconds = integerConfig(config, "idle_seconds", 0);
    if (sampleSeconds < 1 || sampleSeconds > 300) {
      errors.push("sample_seconds must be an integer from 1 to 300");
    }
    if (idleSeconds < 30 || idleSeconds > 86_400) {
      errors.push("idle_seconds must be an integer from 30 to 86400");
    }
    const helperPathError = validateMacosHelperExecutableOverride(
      config.macos_helper_path
    );
    if (helperPathError) errors.push(helperPathError);
    return errors;
  },
  migrations: [{
    name: "001_existing_screen_tables_baseline",
    sql: `
      CREATE TABLE IF NOT EXISTS app_usage (
        id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        seconds INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS app_rules (
        id TEXT PRIMARY KEY,
        app_match TEXT NOT NULL,
        label TEXT NOT NULL,
        start_minute INTEGER,
        end_minute INTEGER,
        weekdays INTEGER[],
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_app_usage_start_at
        ON app_usage(start_at);
    `,
  }, {
    name: "002_screen_understanding_settings",
    sql: `
      CREATE TABLE IF NOT EXISTS screen_understanding_settings (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        capture_interval_seconds INTEGER NOT NULL DEFAULT 60,
        capture_display TEXT NOT NULL DEFAULT 'active',
        skip_when_idle BOOLEAN NOT NULL DEFAULT TRUE,
        provider_profile_id TEXT,
        request_timeout_ms INTEGER NOT NULL DEFAULT 30000,
        max_concurrency INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        daily_request_budget INTEGER NOT NULL DEFAULT 480,
        daily_cost_budget_micros INTEGER NOT NULL DEFAULT 0,
        remote_consent_origin TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT screen_understanding_settings_singleton CHECK (id = 'default'),
        CONSTRAINT screen_understanding_settings_display_check
          CHECK (capture_display = 'active')
      );
    `,
  }, {
    name: "003_screen_understanding_provider_profiles",
    sql: `
      CREATE TABLE IF NOT EXISTS screen_understanding_provider_profiles (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        display_name TEXT NOT NULL,
        provider_kind TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT screen_understanding_provider_profiles_version_check
          CHECK (version >= 1),
        CONSTRAINT screen_understanding_provider_profiles_kind_check
          CHECK (provider_kind = 'openai-compatible'),
        CONSTRAINT screen_understanding_provider_profiles_display_name_check
          CHECK (char_length(display_name) BETWEEN 1 AND 80),
        CONSTRAINT screen_understanding_provider_profiles_model_check
          CHECK (char_length(model) BETWEEN 1 AND 200)
      );
    `,
  }, {
    name: "004_screen_understanding_runtime",
    sql: `
      CREATE TABLE IF NOT EXISTS screen_understanding_requests (
        id TEXT PRIMARY KEY,
        requested_at TIMESTAMPTZ NOT NULL,
        provider_profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        cost_micros INTEGER NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_screen_understanding_requests_requested_at
        ON screen_understanding_requests(requested_at);
      CREATE TABLE IF NOT EXISTS screen_understanding_observations (
        id TEXT PRIMARY KEY,
        captured_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL,
        provider_profile_id TEXT NOT NULL,
        model TEXT NOT NULL,
        summary TEXT NOT NULL,
        activity TEXT NOT NULL,
        confidence REAL NOT NULL,
        sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        apps JSONB NOT NULL,
        latency_ms INTEGER NOT NULL,
        cost_micros INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_screen_understanding_observations_captured_at
        ON screen_understanding_observations(captured_at);
    `,
  }],
  register(context) {
    store = new ScreenStore(context.service<string>("database.url"));
    const helperPath = typeof context.config.macos_helper_path === "string"
      ? context.config.macos_helper_path
      : undefined;
    const exec = (request: Parameters<typeof context.exec>[0], signal?: AbortSignal) =>
      context.exec(request, signal);
    providerProfiles = new ProviderProfileService(
      store,
      new MacKeychainClient(exec, helperPath)
    );
    screenCapture = new MacScreenCaptureService(exec, helperPath);
    understandingSettings = new UnderstandingSettingsService(
      store,
      providerProfiles
    );
    tracker = new ScreenTracker(context, store, {
      sampleSeconds: integerConfig(context.config, "sample_seconds", 5),
      idleSeconds: integerConfig(context.config, "idle_seconds", 180),
    });
    service = new ScreenService(store, tracker);
    screenUnderstanding = new ScreenUnderstandingService(
      store,
      understandingSettings,
      providerProfiles,
      screenCapture,
      new OpenAICompatibleVisionClient(),
      tracker
    );

    context.registerJob({
      id: "foreground-sample",
      intervalMs: tracker.config.sampleSeconds * 1_000,
      timeoutMs: 10_000,
      run: (signal) => tracker!.sample(signal),
    });
    context.registerJob({
      id: "screen-understanding",
      intervalMs: SCREEN_UNDERSTANDING_SCHEDULER_POLL_MS,
      timeoutMs: 130_000,
      run: (signal) => screenUnderstanding!.runScheduled(signal).then(() => undefined),
    });
    context.registerReportSection({
      id: "daily-screen-time",
      title: "屏幕使用",
      order: 200,
      async render(date) {
        const daily = await requireService().getDaily(date);
        if (daily.totalSeconds === 0) return null;
        const labels = daily.byLabel
          .slice(0, 5)
          .map((item) => `- ${item.label}: ${Math.round(item.seconds / 60)} 分钟`);
        return [
          `总计 ${Math.round(daily.totalSeconds / 60)} 分钟。`,
          ...labels,
        ].join("\n");
      },
    });
  },
  start(context) {
    if (process.platform === "darwin") {
      const helperPath = typeof context.config.macos_helper_path === "string"
        ? context.config.macos_helper_path
        : undefined;
      const install = checkMacosHelperInstall(helperPath);
      if (!install.ok) {
        context.logger.warn({
          appBundle: install.appBundle,
          executable: install.executable,
          buildCommand: install.buildCommand,
        }, install.message);
      }
    }
    context.logger.info(
      { sampleSeconds: tracker?.config.sampleSeconds },
      "Screen Time plugin started"
    );
  },
  async stop() {
    await tracker?.stop();
    await store?.close();
    tracker = null;
    service = null;
    understandingSettings = null;
    providerProfiles = null;
    screenCapture = null;
    screenUnderstanding = null;
    store = null;
  },
  async doctor(context) {
    if (process.platform !== "darwin") {
      return [{
        id: "platform",
        ok: false,
        message: `screen-time requires darwin; current platform is ${process.platform}`,
      }];
    }
    const checks = [];
    for (const [id, args] of [
      ["lsappinfo", ["front"]],
      ["ioreg", ["-c", "IOHIDSystem"]],
      ["pmset", ["-g", "assertions"]],
    ] as const) {
      try {
        const result = await context.exec({
          executable: id,
          args: [...args],
          timeoutMs: 4_000,
        });
        checks.push({
          id: `executable:${id}`,
          ok: result.exitCode === 0,
          message:
            result.exitCode === 0
              ? `${id} is available`
              : `${id} exited with ${result.exitCode}`,
        });
      } catch (error) {
        checks.push({
          id: `executable:${id}`,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    checks.push(...await new MacScreenCaptureService(
      (request, signal) => context.exec(request, signal),
      typeof context.config.macos_helper_path === "string"
        ? context.config.macos_helper_path
        : undefined
    ).doctor());
    return checks;
  },
};

export default screenTimePlugin;
