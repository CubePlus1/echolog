import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import type { ScreenService } from "./screen.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

type ServiceProvider = () => ScreenService;

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

function handlers(service: ServiceProvider) {
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
  };
}

export function createScreenRoutes(service: ServiceProvider): PluginRoute[] {
  const routeHandlers = handlers(service);
  const definitions: Array<{
    method: PluginRoute["method"];
    suffix: string;
    handler: PluginRoute["handler"];
  }> = [
    { method: "GET", suffix: "/today", handler: routeHandlers.today },
    { method: "GET", suffix: "/daily/:date", handler: routeHandlers.daily },
    { method: "GET", suffix: "/rules", handler: routeHandlers.listRules },
    { method: "POST", suffix: "/rules", handler: routeHandlers.createRule },
    {
      method: "DELETE",
      suffix: "/rules/:id",
      handler: routeHandlers.deleteRule,
    },
  ];

  return definitions.flatMap(({ method, suffix, handler }) => [
    {
      method,
      path: `/api/plugins/screen-time${suffix}`,
      handler,
    },
    {
      method,
      path: `/api/screen${suffix}`,
      compatibilityAlias: true,
      handler,
    },
  ]);
}
