import {
  PLUGIN_API_VERSION,
  PluginError,
  validatePluginManifest,
  type PluginCommandRequest,
  type PluginContext,
  type PluginDefinition,
  type PluginDoctorCheck,
  type PluginJob,
  type PluginLogger,
  type PluginPermission,
  type PluginReportSection,
  type PluginRoute,
  type PluginErrorCode,
  type PluginRuntimeInfo,
  type PluginState,
} from "@echolog/plugin-sdk";
import type { PluginMigrationRunner } from "./migrations.js";
import type { PluginCommandRunner } from "./command-runner.js";

interface Runtime {
  definition: PluginDefinition;
  context: PluginContext;
  setConfig(config: Readonly<Record<string, unknown>>): void;
  info: PluginRuntimeInfo;
  routes: PluginRoute[];
  jobs: Map<string, PluginJobRuntime>;
  reportSections: PluginReportSection[];
}

interface PluginJobRuntime {
  definition: PluginJob;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
  abortController: AbortController | null;
}

const SERVICE_PERMISSIONS: Readonly<Record<string, PluginPermission>> = {
  "database.url": "database:plugin",
  "notifications.send": "notifications:send",
};

export interface PluginHostOptions {
  definitions: readonly PluginDefinition[];
  configuration?: Record<
    string,
    { enabled?: boolean; config?: Record<string, unknown> }
  >;
  logger: PluginLogger;
  migrationRunner: PluginMigrationRunner;
  commandRunner: PluginCommandRunner;
  services?: Record<string, unknown>;
}

function freezeConfig(config: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...config });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateRoute(pluginId: string, route: PluginRoute): void {
  const namespaced = route.path.startsWith(`/api/plugins/${pluginId}/`);
  if (!namespaced && !route.compatibilityAlias) {
    throw new Error(`Plugin route must be namespaced: ${route.path}`);
  }
}

function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PluginError(
        "PLUGIN_TIMEOUT",
        `Plugin operation timed out after ${timeoutMs}ms`,
        "unknown",
        "degraded",
        504
      ));
    }, timeoutMs);
  });
  return Promise.race([operation(controller.signal), timeout]).finally(() =>
    clearTimeout(timer)
  );
}

export class PluginHost {
  private readonly runtimes = new Map<string, Runtime>();

  constructor(private readonly options: PluginHostOptions) {
    for (const [index, definition] of options.definitions.entries()) {
      const manifest = definition.manifest as Partial<PluginDefinition["manifest"]>;
      const id = typeof manifest?.id === "string"
        ? manifest.id
        : `invalid-plugin-${index + 1}`;
      if (this.runtimes.has(id)) throw new Error(`Duplicate plugin id: ${id}`);

      const configured = Object.hasOwn(options.configuration ?? {}, id);
      const settings = options.configuration?.[id];
      const enabled = settings?.enabled ?? definition.defaultEnabled ?? false;
      const routes: PluginRoute[] = [];
      const reportSections: PluginReportSection[] = [];
      const jobs = new Map<string, PluginJobRuntime>();
      const info: PluginRuntimeInfo = {
        id,
        displayName: id,
        version: "",
        apiVersion: "",
        configured,
        enabled,
        state: enabled ? "validating" : "disabled",
        capabilities: [],
        permissions: [],
        failureCount: 0,
      };

      let contextConfig = freezeConfig({});
      const context: PluginContext = {
        pluginId: id,
        get config() {
          return contextConfig;
        },
        logger: options.logger,
        registerRoute: (route) => {
          validateRoute(id, route);
          routes.push(route);
        },
        registerJob: (job) => {
          if (job.intervalMs <= 0) throw new Error(`Invalid job interval: ${job.id}`);
          if (jobs.has(job.id)) throw new Error(`Duplicate plugin job: ${id}/${job.id}`);
          jobs.set(job.id, {
            definition: job,
            timer: null as unknown as ReturnType<typeof setInterval>,
            running: false,
            abortController: null,
          });
        },
        registerReportSection: (section) => {
          if (reportSections.some((item) => item.id === section.id)) {
            throw new Error(`Duplicate report section: ${id}/${section.id}`);
          }
          reportSections.push(section);
        },
        exec: (request: PluginCommandRequest, signal?: AbortSignal) => {
          if (!info.permissions.includes("process:exec")) {
            throw new PluginError(
              "PLUGIN_DEPENDENCY_MISSING",
              `Plugin ${id} has not declared process:exec`,
              id,
              info.state,
              403
            );
          }
          return options.commandRunner(request, signal);
        },
        service: <T>(name: string): T => {
          const requiredPermission = SERVICE_PERMISSIONS[name];
          if (
            requiredPermission &&
            !info.permissions.includes(requiredPermission)
          ) {
            throw new PluginError(
              "PLUGIN_DEPENDENCY_MISSING",
              `Plugin ${id} has not declared ${requiredPermission}`,
              id,
              info.state,
              403
            );
          }
          if (!Object.hasOwn(options.services ?? {}, name)) {
            throw new Error(`Plugin service is not available: ${name}`);
          }
          return options.services?.[name] as T;
        },
      };

      this.runtimes.set(id, {
        definition,
        context,
        setConfig(config) {
          contextConfig = config;
        },
        info,
        routes,
        jobs,
        reportSections,
      });
    }
  }

  async initialize(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      try {
        this.setState(runtime, "validating");
        const manifestErrors = validatePluginManifest(runtime.definition.manifest);
        if (runtime.definition.manifest.apiVersion !== PLUGIN_API_VERSION) {
          throw new PluginError(
            "PLUGIN_API_INCOMPATIBLE",
            `Plugin API ${runtime.definition.manifest.apiVersion} is not supported`,
            runtime.info.id,
            "validating"
          );
        }
        if (manifestErrors.length > 0) {
          throw new Error(manifestErrors.join("; "));
        }
        const manifest = runtime.definition.manifest;
        runtime.info.displayName = manifest.displayName;
        runtime.info.version = manifest.version;
        runtime.info.apiVersion = manifest.apiVersion;
        runtime.info.capabilities = [...manifest.capabilities];
        runtime.info.permissions = [...manifest.permissions];
        runtime.info.webEntry = manifest.entries.web;

        // Static compatibility routes remain installed for a valid disabled
        // plugin so callers receive the Host's structured disabled response.
        // Invalid manifests never reach this point, keeping their definitions
        // inert inside the per-plugin isolation boundary.
        const routes = [...(runtime.definition.routes ?? [])];
        for (const route of routes) validateRoute(runtime.info.id, route);
        runtime.routes.push(...routes);
        if (!runtime.info.enabled) {
          this.setState(runtime, "disabled");
          continue;
        }

        const settings = this.options.configuration?.[runtime.info.id];
        const rawConfig = {
          ...(runtime.definition.defaultConfig ?? {}),
          ...(settings?.config ?? {}),
        };
        const mergedConfig = runtime.definition.normalizeConfig?.(rawConfig)
          ?? rawConfig;
        runtime.setConfig(freezeConfig(mergedConfig));

        const configErrors = runtime.definition.validateConfig?.(
          runtime.context.config
        ) ?? [];
        if (configErrors.length > 0) throw new Error(configErrors.join("; "));

        this.setState(runtime, "migrating");
        await this.options.migrationRunner(
          runtime.info.id,
          runtime.definition.migrations ?? []
        );

        this.setState(runtime, "starting");
        await runtime.definition.register?.(runtime.context);
        await runtime.definition.start?.(runtime.context);
        this.startJobs(runtime);
        this.setState(runtime, "ready");
      } catch (error) {
        this.fail(runtime, error);
      }
    }
  }

  async stop(): Promise<void> {
    const runtimes = [...this.runtimes.values()].reverse();
    for (const runtime of runtimes) {
      if (!runtime.info.enabled) continue;
      this.setState(runtime, "stopping");
      this.stopJobs(runtime);
      try {
        await withTimeout(5_000, (signal) =>
          Promise.resolve(runtime.definition.stop?.(runtime.context, signal))
        );
      } catch (error) {
        this.recordError(runtime, error, "PLUGIN_DEGRADED");
      }
    }
  }

  list(): PluginRuntimeInfo[] {
    return [...this.runtimes.values()]
      .map((runtime) => structuredClone(runtime.info))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  routes(): Array<{ pluginId: string; route: PluginRoute }> {
    return [...this.runtimes.values()].flatMap((runtime) =>
      runtime.routes.map((route) => ({ pluginId: runtime.info.id, route }))
    );
  }

  assertReady(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) {
      throw new PluginError(
        "PLUGIN_DEPENDENCY_MISSING",
        `Plugin ${pluginId} is not bundled`,
        pluginId,
        "degraded",
        404
      );
    }
    if (runtime.info.state === "disabled") {
      throw new PluginError(
        "PLUGIN_DISABLED",
        `Plugin ${pluginId} is disabled`,
        pluginId,
        "disabled"
      );
    }
    if (runtime.info.state !== "ready") {
      throw new PluginError(
        "PLUGIN_DEGRADED",
        runtime.info.error?.message ?? `Plugin ${pluginId} is unavailable`,
        pluginId,
        runtime.info.state
      );
    }
  }

  async doctor(): Promise<{
    ok: boolean;
    plugins: Array<PluginRuntimeInfo & { checks: PluginDoctorCheck[] }>;
  }> {
    const plugins = [];
    for (const runtime of this.runtimes.values()) {
      let checks: PluginDoctorCheck[] = [];
      if (runtime.info.enabled && runtime.definition.doctor) {
        try {
          checks = await runtime.definition.doctor(runtime.context);
        } catch (error) {
          checks = [{ id: "doctor", ok: false, message: errorMessage(error) }];
        }
      }
      plugins.push({ ...structuredClone(runtime.info), checks });
    }
    return {
      ok: plugins.every(
        (plugin) =>
          !plugin.enabled ||
          (plugin.state === "ready" && plugin.checks.every((check) => check.ok))
      ),
      plugins,
    };
  }

  async renderReportSections(date: string): Promise<string[]> {
    const rendered: Array<{ order: number; markdown: string }> = [];
    for (const runtime of this.runtimes.values()) {
      if (runtime.info.state !== "ready") continue;
      for (const section of runtime.reportSections) {
        try {
          const body = await withTimeout(section.timeoutMs ?? 5_000, (signal) =>
            section.render(date, signal)
          );
          if (body?.trim()) {
            rendered.push({
              order: section.order ?? 100,
              markdown: `## ${section.title}\n\n${body.trim()}`,
            });
          }
        } catch (error) {
          this.recordError(runtime, error, "PLUGIN_DEGRADED");
        }
      }
    }
    return rendered
      .sort((a, b) => a.order - b.order)
      .map((section) => section.markdown);
  }

  private setState(runtime: Runtime, state: PluginState): void {
    runtime.info.state = state;
  }

  private fail(runtime: Runtime, error: unknown): void {
    const code =
      error instanceof PluginError ? error.code : "PLUGIN_DEGRADED";
    this.recordError(runtime, error, code);
    runtime.info.state = "degraded";
  }

  private recordError(
    runtime: Runtime,
    error: unknown,
    code: PluginErrorCode
  ): void {
    runtime.info.failureCount++;
    runtime.info.lastErrorAt = new Date().toISOString();
    runtime.info.error = { code, message: errorMessage(error) };
    this.options.logger.error(
      { pluginId: runtime.info.id, error: errorMessage(error) },
      "Plugin operation failed"
    );
  }

  private startJobs(runtime: Runtime): void {
    for (const job of runtime.jobs.values()) {
      job.timer = setInterval(() => {
        void this.runJob(runtime, job);
      }, job.definition.intervalMs);
    }
  }

  private async runJob(runtime: Runtime, job: PluginJobRuntime): Promise<void> {
    if (job.running || runtime.info.state !== "ready") return;
    job.running = true;
    job.abortController = new AbortController();
    const timeoutMs =
      job.definition.timeoutMs ?? Math.min(job.definition.intervalMs, 30_000);
    const controller = job.abortController;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new PluginError(
          "PLUGIN_TIMEOUT",
          `Plugin job ${runtime.info.id}/${job.definition.id} timed out after ${timeoutMs}ms`,
          runtime.info.id,
          runtime.info.state,
          504
        ));
      }, timeoutMs);
    });
    try {
      await Promise.race([
        Promise.resolve(job.definition.run(controller.signal)),
        timeout,
      ]);
    } catch (error) {
      this.recordError(
        runtime,
        error,
        error instanceof PluginError ? error.code : "PLUGIN_DEGRADED"
      );
    } finally {
      if (timer) clearTimeout(timer);
      job.abortController = null;
      job.running = false;
    }
  }

  private stopJobs(runtime: Runtime): void {
    for (const job of runtime.jobs.values()) {
      clearInterval(job.timer);
      job.abortController?.abort();
    }
  }
}
