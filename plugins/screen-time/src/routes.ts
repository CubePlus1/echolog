import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import type { ScreenService } from "./screen.js";
import {
  CaptureError,
  type MacScreenCaptureService,
} from "./macos-screen-capture.js";
import {
  UnderstandingError,
  type ScreenUnderstandingService,
} from "./understanding.js";
import {
  PROVIDER_PROFILE_ID_RE,
  ProviderError,
  validateProviderCreate,
  validateProviderDelete,
  validateProviderKey,
  validateProviderUpdate,
  type ProviderProfileService,
} from "./provider-profiles.js";
import {
  validateUnderstandingSettingsUpdate,
  type UnderstandingSettingsService,
} from "./understanding-settings.js";
import { VisionProviderError } from "./vision-provider.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

type ServiceProvider = () => ScreenService;
type SettingsProvider = () => UnderstandingSettingsService;
type ProfilesProvider = () => ProviderProfileService;
type CaptureProvider = () => MacScreenCaptureService;
type UnderstandingProvider = () => ScreenUnderstandingService;

function response(statusCode: number, body: unknown): PluginHttpResponse {
  return { statusCode, body };
}

function localDateStr(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function toMinute(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateRuleBody(body: unknown):
  | {
      ok: true;
      value: {
        appMatch: string;
        label: string;
        startMinute: number | null;
        endMinute: number | null;
        weekdays: number[] | null;
        priority: number;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  const value = body as Record<string, unknown>;
  if (
    typeof value.appMatch !== "string" ||
    value.appMatch.trim().length < 1 ||
    value.appMatch.length > 200
  ) {
    return { ok: false, error: "appMatch must be a non-empty string" };
  }
  if (
    typeof value.label !== "string" ||
    value.label.trim().length < 1 ||
    value.label.length > 50
  ) {
    return { ok: false, error: "label must be a non-empty string" };
  }
  const hasStart = value.startTime != null;
  const hasEnd = value.endTime != null;
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      error: "startTime and endTime must be provided together",
    };
  }
  if (
    hasStart &&
    (typeof value.startTime !== "string" ||
      typeof value.endTime !== "string" ||
      !TIME_RE.test(value.startTime) ||
      !TIME_RE.test(value.endTime))
  ) {
    return { ok: false, error: "startTime and endTime must be HH:mm" };
  }
  if (hasStart && value.startTime === value.endTime) {
    return {
      ok: false,
      error: "startTime and endTime must differ (omit both for all-day)",
    };
  }
  if (
    value.weekdays != null &&
    (!Array.isArray(value.weekdays) ||
      value.weekdays.length > 7 ||
      value.weekdays.some(
        (day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6
      ))
  ) {
    return { ok: false, error: "weekdays must contain integers from 0 to 6" };
  }
  if (
    value.priority != null &&
    (!Number.isInteger(value.priority) ||
      Number(value.priority) < -1_000 ||
      Number(value.priority) > 1_000)
  ) {
    return { ok: false, error: "priority must be an integer from -1000 to 1000" };
  }
  return {
    ok: true,
    value: {
      appMatch: value.appMatch.trim(),
      label: value.label.trim(),
      startMinute: hasStart ? toMinute(value.startTime as string) : null,
      endMinute: hasEnd ? toMinute(value.endTime as string) : null,
      weekdays:
        Array.isArray(value.weekdays) && value.weekdays.length
          ? value.weekdays as number[]
          : null,
      priority: value.priority == null ? 0 : Number(value.priority),
    },
  };
}

function providerError(error: unknown): PluginHttpResponse {
  if (!(error instanceof ProviderError)) throw error;
  return response(error.statusCode, {
    error: error.message,
    code: error.code,
    ...(error.currentVersion === undefined
      ? {}
      : { currentVersion: error.currentVersion }),
  });
}

function captureError(error: unknown): PluginHttpResponse {
  if (!(error instanceof CaptureError)) throw error;
  return response(error.statusCode, {
    error: error.message,
    code: error.code,
  });
}

function understandingError(error: unknown): PluginHttpResponse {
  if (error instanceof UnderstandingError || error instanceof VisionProviderError) {
    return response(error.statusCode, {
      error: error.message,
      code: error.code,
    });
  }
  return providerError(error);
}

function validProfileId(id: string): boolean {
  return PROVIDER_PROFILE_ID_RE.test(id);
}

function handlers(
  service: ServiceProvider,
  settings?: SettingsProvider,
  profiles?: ProfilesProvider,
  capture?: CaptureProvider,
  understanding?: UnderstandingProvider
) {
  return {
    today: async () => service().getDaily(localDateStr()),
    daily: async (request: PluginHttpRequest) => {
      const { date } = request.params;
      return DATE_RE.test(date)
        ? service().getDaily(date)
        : response(400, { error: "date must be YYYY-MM-DD" });
    },
    listRules: async () => service().listRules(),
    createRule: async (request: PluginHttpRequest) => {
      const validated = validateRuleBody(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      return response(201, await service().createRule(validated.value));
    },
    deleteRule: async (request: PluginHttpRequest) => {
      const deleted = await service().deleteRule(request.params.id);
      return deleted ??
        response(404, { error: `Rule ${request.params.id} not found` });
    },
    getUnderstandingSettings: async () => {
      if (!settings) throw new Error("understanding settings service is unavailable");
      return settings().get();
    },
    updateUnderstandingSettings: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!settings) throw new Error("understanding settings service is unavailable");
      const validated = validateUnderstandingSettingsUpdate(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      const { expectedVersion, ...input } = validated.value;
      try {
        const result = await settings().update(expectedVersion, input, signal);
        return result.ok
          ? result.settings
          : response(409, {
              error: "screen understanding settings version conflict",
              currentVersion: result.currentVersion,
            });
      } catch (error) {
        return providerError(error);
      }
    },
    listProviders: async (_request: PluginHttpRequest, signal: AbortSignal) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      try {
        return { providers: await profiles().list(signal) };
      } catch (error) {
        return providerError(error);
      }
    },
    createProvider: async (request: PluginHttpRequest) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      const validated = validateProviderCreate(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      try {
        return response(201, await profiles().create(validated.value));
      } catch (error) {
        return providerError(error);
      }
    },
    updateProvider: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      if (!validProfileId(request.params.id)) {
        return response(400, { error: "provider id is invalid" });
      }
      const validated = validateProviderUpdate(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      const { expectedVersion, ...input } = validated.value;
      try {
        return await profiles().update(
          request.params.id,
          expectedVersion,
          input,
          signal
        );
      } catch (error) {
        return providerError(error);
      }
    },
    deleteProvider: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      if (!validProfileId(request.params.id)) {
        return response(400, { error: "provider id is invalid" });
      }
      const validated = validateProviderDelete(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      try {
        await profiles().deleteProfile(
          request.params.id,
          validated.value.expectedVersion,
          signal
        );
        return response(204, null);
      } catch (error) {
        return providerError(error);
      }
    },
    setProviderKey: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      if (!validProfileId(request.params.id)) {
        return response(400, { error: "provider id is invalid" });
      }
      const validated = validateProviderKey(request.body);
      if (!validated.ok) return response(400, { error: validated.error });
      try {
        return await profiles().setKey(
          request.params.id,
          validated.value.apiKey,
          signal
        );
      } catch (error) {
        return providerError(error);
      }
    },
    deleteProviderKey: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!profiles) throw new Error("provider profile service is unavailable");
      if (!validProfileId(request.params.id)) {
        return response(400, { error: "provider id is invalid" });
      }
      try {
        return await profiles().deleteKey(request.params.id, signal);
      } catch (error) {
        return providerError(error);
      }
    },
    testCapture: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!capture) throw new Error("screen capture service is unavailable");
      if (
        !request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body as Record<string, unknown>).length !== 0
      ) {
        return response(400, { error: "capture test body must be an empty object" });
      }
      try {
        return await capture().captureTest(signal);
      } catch (error) {
        return captureError(error);
      }
    },
    runUnderstanding: async (
      request: PluginHttpRequest,
      signal: AbortSignal
    ) => {
      if (!understanding) throw new Error("screen understanding service is unavailable");
      if (
        !request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body as Record<string, unknown>).length !== 0
      ) {
        return response(400, { error: "understanding run body must be an empty object" });
      }
      try {
        return await understanding().run(signal);
      } catch (error) {
        return understandingError(error);
      }
    },
    latestUnderstanding: async () => {
      if (!understanding) throw new Error("screen understanding service is unavailable");
      return understanding().latest();
    },
    understandingHistory: async (request: PluginHttpRequest) => {
      if (!understanding) throw new Error("screen understanding service is unavailable");
      const query = request.query;
      const raw = query && typeof query === "object"
        ? (query as Record<string, unknown>).limit
        : undefined;
      const limit = raw == null ? 20 : Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return response(400, { error: "limit must be an integer from 1 to 100" });
      }
      return understanding().history(limit);
    },
  };
}

export function createScreenRoutes(
  service: ServiceProvider,
  settings?: SettingsProvider,
  profiles?: ProfilesProvider,
  capture?: CaptureProvider,
  understanding?: UnderstandingProvider
): PluginRoute[] {
  const routeHandlers = handlers(service, settings, profiles, capture, understanding);
  const definitions: Array<{
    method: PluginRoute["method"];
    suffix: string;
    handler: PluginRoute["handler"];
    compatibilityAlias?: boolean;
    localOnly?: boolean;
  }> = [
    {
      method: "GET",
      suffix: "/today",
      handler: routeHandlers.today,
      compatibilityAlias: true,
    },
    {
      method: "GET",
      suffix: "/daily/:date",
      handler: routeHandlers.daily,
      compatibilityAlias: true,
    },
    {
      method: "GET",
      suffix: "/rules",
      handler: routeHandlers.listRules,
      compatibilityAlias: true,
    },
    {
      method: "POST",
      suffix: "/rules",
      handler: routeHandlers.createRule,
      compatibilityAlias: true,
    },
    {
      method: "DELETE",
      suffix: "/rules/:id",
      handler: routeHandlers.deleteRule,
      compatibilityAlias: true,
    },
    {
      method: "GET",
      suffix: "/understanding/settings",
      handler: routeHandlers.getUnderstandingSettings,
    },
    {
      method: "PUT",
      suffix: "/understanding/settings",
      handler: routeHandlers.updateUnderstandingSettings,
    },
    ...(profiles ? [{
      method: "GET" as const,
      suffix: "/understanding/providers",
      handler: routeHandlers.listProviders,
    }, {
      method: "POST" as const,
      suffix: "/understanding/providers",
      handler: routeHandlers.createProvider,
    }, {
      method: "PUT" as const,
      suffix: "/understanding/providers/:id",
      handler: routeHandlers.updateProvider,
    }, {
      method: "DELETE" as const,
      suffix: "/understanding/providers/:id",
      handler: routeHandlers.deleteProvider,
    }, {
      method: "PUT" as const,
      suffix: "/understanding/providers/:id/key",
      handler: routeHandlers.setProviderKey,
      localOnly: true,
    }, {
      method: "DELETE" as const,
      suffix: "/understanding/providers/:id/key",
      handler: routeHandlers.deleteProviderKey,
      localOnly: true,
    }] : []),
    ...(capture ? [{
      method: "POST" as const,
      suffix: "/understanding/capture/test",
      handler: routeHandlers.testCapture,
      localOnly: true,
    }] : []),
    ...(understanding ? [{
      method: "POST" as const,
      suffix: "/understanding/run",
      handler: routeHandlers.runUnderstanding,
      localOnly: true,
    }, {
      method: "GET" as const,
      suffix: "/understanding/latest",
      handler: routeHandlers.latestUnderstanding,
    }, {
      method: "GET" as const,
      suffix: "/understanding/history",
      handler: routeHandlers.understandingHistory,
    }] : []),
  ];

  return definitions.flatMap(
    ({ method, suffix, handler, compatibilityAlias, localOnly }) => [{
      method,
      path: `/api/plugins/screen-time${suffix}`,
      ...(localOnly ? { localOnly: true } : {}),
      handler,
    }, ...(compatibilityAlias ? [{
        method,
        path: `/api/screen${suffix}`,
        compatibilityAlias: true,
        handler,
      } satisfies PluginRoute] : [])]
  );
}
