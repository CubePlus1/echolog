import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import { FlowStoreError } from "./flow-store.js";
import type { FlowService } from "./flow.js";
import type {
  FlowOutcome,
  FlowOutcomeInput,
  FlowSettingsUpdate,
} from "./types.js";

const DELIVERY_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const FLOW_OUTCOMES = new Set<FlowOutcome>([
  "viewed",
  "continued",
  "kept",
  "later",
  "archived",
]);
const SETTINGS_KEYS = [
  "expectedVersion",
  "enabled",
  "intervalMinutes",
  "quietStartMinute",
  "quietEndMinute",
  "cooldownMinutes",
  "dailyLimit",
  "defaultSnoozeMinutes",
  "statuses",
  "tags",
  "projects",
] as const;

type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function response(statusCode: number, body: unknown): PluginHttpResponse {
  return { statusCode, body };
}

function record(body: unknown): Validation<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number
): Validation<number> {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? { ok: true, value: Number(value) }
    : {
        ok: false,
        error: `${name} must be an integer from ${minimum} to ${maximum}`,
      };
}

function stringArray(
  value: unknown,
  name: string,
  maximumItems: number,
  maximumLength: number
): Validation<string[]> {
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.length > maximumLength
    )
  ) {
    return {
      ok: false,
      error: `${name} must contain at most ${maximumItems} non-empty strings up to ${maximumLength} characters`,
    };
  }
  const normalized = value.map((item) => (item as string).trim());
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, error: `${name} must not contain duplicates` };
  }
  return { ok: true, value: normalized };
}

export function validateSettingsUpdate(
  body: unknown
): Validation<FlowSettingsUpdate> {
  const object = record(body);
  if (!object.ok) return object;
  if (
    !hasExactKeys(object.value, SETTINGS_KEYS) ||
    SETTINGS_KEYS.some((key) => !(key in object.value))
  ) {
    return {
      ok: false,
      error: `body must contain exactly ${SETTINGS_KEYS.join(", ")}`,
    };
  }
  if (typeof object.value.enabled !== "boolean") {
    return { ok: false, error: "enabled must be a boolean" };
  }
  const expectedVersion = integer(
    object.value.expectedVersion,
    "expectedVersion",
    1,
    2_147_483_647
  );
  if (!expectedVersion.ok) return expectedVersion;
  const intervalMinutes = integer(
    object.value.intervalMinutes,
    "intervalMinutes",
    1,
    10_080
  );
  if (!intervalMinutes.ok) return intervalMinutes;
  const quietStartMinute = integer(
    object.value.quietStartMinute,
    "quietStartMinute",
    0,
    1_439
  );
  if (!quietStartMinute.ok) return quietStartMinute;
  const quietEndMinute = integer(
    object.value.quietEndMinute,
    "quietEndMinute",
    0,
    1_439
  );
  if (!quietEndMinute.ok) return quietEndMinute;
  const cooldownMinutes = integer(
    object.value.cooldownMinutes,
    "cooldownMinutes",
    0,
    525_600
  );
  if (!cooldownMinutes.ok) return cooldownMinutes;
  const dailyLimit = integer(
    object.value.dailyLimit,
    "dailyLimit",
    1,
    1_000
  );
  if (!dailyLimit.ok) return dailyLimit;
  const defaultSnoozeMinutes = integer(
    object.value.defaultSnoozeMinutes,
    "defaultSnoozeMinutes",
    1,
    525_600
  );
  if (!defaultSnoozeMinutes.ok) return defaultSnoozeMinutes;

  const statuses = stringArray(object.value.statuses, "statuses", 2, 10);
  if (!statuses.ok) return statuses;
  if (
    statuses.value.length === 0 ||
    statuses.value.some((status) => status !== "inbox" && status !== "kept")
  ) {
    return { ok: false, error: "statuses must contain inbox and/or kept" };
  }
  const tags = stringArray(object.value.tags, "tags", 50, 50);
  if (!tags.ok) return tags;
  const normalizedTags = tags.value.map((tag) => tag.toLowerCase()).sort();
  if (new Set(normalizedTags).size !== normalizedTags.length) {
    return { ok: false, error: "tags must not contain duplicates" };
  }
  const projects = stringArray(object.value.projects, "projects", 50, 100);
  if (!projects.ok) return projects;

  return {
    ok: true,
    value: {
      expectedVersion: expectedVersion.value,
      enabled: object.value.enabled,
      intervalMinutes: intervalMinutes.value,
      quietStartMinute: quietStartMinute.value,
      quietEndMinute: quietEndMinute.value,
      cooldownMinutes: cooldownMinutes.value,
      dailyLimit: dailyLimit.value,
      defaultSnoozeMinutes: defaultSnoozeMinutes.value,
      statuses: statuses.value as FlowSettingsUpdate["statuses"],
      tags: normalizedTags,
      projects: projects.value,
    },
  };
}

export function validateOutcome(body: unknown): Validation<FlowOutcomeInput> {
  const object = record(body);
  if (!object.ok) return object;
  if (
    !hasExactKeys(object.value, [
      "expectedDeliveryVersion",
      "expectedInspirationVersion",
      "outcome",
      "snoozeMinutes",
    ])
  ) {
    return { ok: false, error: "outcome body contains unknown fields" };
  }
  const expectedDeliveryVersion = integer(
    object.value.expectedDeliveryVersion,
    "expectedDeliveryVersion",
    1,
    2_147_483_647
  );
  if (!expectedDeliveryVersion.ok) return expectedDeliveryVersion;
  const expectedInspirationVersion = integer(
    object.value.expectedInspirationVersion,
    "expectedInspirationVersion",
    1,
    2_147_483_647
  );
  if (!expectedInspirationVersion.ok) return expectedInspirationVersion;
  if (!FLOW_OUTCOMES.has(object.value.outcome as FlowOutcome)) {
    return {
      ok: false,
      error: "outcome must be viewed, continued, kept, later, or archived",
    };
  }
  const outcome = object.value.outcome as FlowOutcome;
  if (outcome !== "later" && object.value.snoozeMinutes !== undefined) {
    return { ok: false, error: "snoozeMinutes is only valid for later" };
  }
  let snoozeMinutes: number | undefined;
  if (object.value.snoozeMinutes !== undefined) {
    const validated = integer(
      object.value.snoozeMinutes,
      "snoozeMinutes",
      1,
      525_600
    );
    if (!validated.ok) return validated;
    snoozeMinutes = validated.value;
  }
  return {
    ok: true,
    value: {
      expectedDeliveryVersion: expectedDeliveryVersion.value,
      expectedInspirationVersion: expectedInspirationVersion.value,
      outcome,
      ...(snoozeMinutes === undefined ? {} : { snoozeMinutes }),
    },
  };
}

function flowError(error: unknown): PluginHttpResponse {
  if (!(error instanceof FlowStoreError)) throw error;
  return response(error.statusCode, {
    error: error.message,
    code: error.code,
    ...(error.currentDeliveryVersion === undefined
      ? {}
      : { currentDeliveryVersion: error.currentDeliveryVersion }),
    ...(error.currentInspirationVersion === undefined
      ? {}
      : { currentInspirationVersion: error.currentInspirationVersion }),
  });
}

export function createFlowRoutes(service: () => FlowService): PluginRoute[] {
  return [
    {
      method: "GET",
      path: "/api/plugins/inspiration/flow/settings",
      async handler() {
        return service().getSettings();
      },
    },
    {
      method: "PATCH",
      path: "/api/plugins/inspiration/flow/settings",
      async handler(request) {
        const validated = validateSettingsUpdate(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        const updated = await service().updateSettings(validated.value);
        if (updated) return updated;
        const current = await service().getSettings();
        return response(409, {
          error: "Flow settings version conflict",
          code: "VERSION_CONFLICT",
          currentVersion: current.version,
        });
      },
    },
    {
      method: "POST",
      path: "/api/plugins/inspiration/flow/next",
      async handler(request: PluginHttpRequest, signal) {
        const body = request.body == null ? {} : request.body;
        const object = record(body);
        if (!object.ok) return response(400, { error: object.error });
        if (!hasExactKeys(object.value, ["idempotencyKey"])) {
          return response(400, { error: "next body contains unknown fields" });
        }
        const idempotencyKey = object.value.idempotencyKey;
        if (
          idempotencyKey !== undefined &&
          (typeof idempotencyKey !== "string" ||
            idempotencyKey.trim().length === 0 ||
            idempotencyKey.length > 200)
        ) {
          return response(400, {
            error: "idempotencyKey must be a non-empty string up to 200 characters",
          });
        }
        try {
          const result = await service().nextManual(
            typeof idempotencyKey === "string" ? idempotencyKey : undefined,
            signal
          );
          return {
            candidate: result.candidate,
            explanation: result.explanation,
          };
        } catch (error) {
          return flowError(error);
        }
      },
    },
    {
      method: "GET",
      path: "/api/plugins/inspiration/flow/deliveries",
      async handler(request) {
        const query = request.query == null ? {} : request.query;
        if (!query || typeof query !== "object" || Array.isArray(query)) {
          return response(400, { error: "query must be an object" });
        }
        const value = query as Record<string, unknown>;
        if (!hasExactKeys(value, ["limit", "before"])) {
          return response(400, { error: "deliveries query contains unknown fields" });
        }
        const rawLimit = value.limit === undefined ? 50 : Number(value.limit);
        const limit = integer(rawLimit, "limit", 1, 100);
        if (!limit.ok) return response(400, { error: limit.error });
        let before: Date | undefined;
        if (value.before !== undefined) {
          if (typeof value.before !== "string") {
            return response(400, { error: "before must be an ISO 8601 timestamp" });
          }
          before = new Date(value.before);
          if (!value.before.includes("T") || Number.isNaN(before.getTime())) {
            return response(400, { error: "before must be an ISO 8601 timestamp" });
          }
        }
        return { deliveries: await service().listDeliveries(limit.value, before) };
      },
    },
    {
      method: "POST",
      path: "/api/plugins/inspiration/flow/deliveries/:id/outcome",
      async handler(request) {
        if (!DELIVERY_ID_RE.test(request.params.id)) {
          return response(400, { error: "delivery id is invalid" });
        }
        const validated = validateOutcome(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        try {
          return await service().applyOutcome(
            request.params.id,
            validated.value
          );
        } catch (error) {
          return flowError(error);
        }
      },
    },
  ];
}
