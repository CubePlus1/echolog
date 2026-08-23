import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import {
  ScheduleConflictError,
  ScheduleNotFoundError,
  type ScheduleStore,
} from "./store.js";
import {
  validateCreateScheduleItem,
  validateEditScheduleItem,
  validateExpectedVersionBody,
  validateItemId,
  validateListQuery,
  validateReminderQuery,
  validateScheduleInterval,
  validateSnoozeBody,
} from "./validation.js";

type StoreProvider = () => ScheduleStore;

function response(statusCode: number, body: unknown): PluginHttpResponse {
  return { statusCode, body };
}

function scheduleError(error: unknown): PluginHttpResponse {
  if (error instanceof ScheduleNotFoundError) {
    return response(404, { error: error.message });
  }
  if (error instanceof ScheduleConflictError) {
    return response(409, {
      error: error.message,
      currentVersion: error.metadata.currentVersion,
      currentStatus: error.metadata.currentStatus,
    });
  }
  throw error;
}

function invalidItemId(request: PluginHttpRequest): PluginHttpResponse | null {
  const error = validateItemId(request.params.id);
  return error ? response(400, { error }) : null;
}

export function createScheduleRoutes(store: StoreProvider): PluginRoute[] {
  const prefix = "/api/plugins/schedule";
  return [
    {
      method: "GET",
      path: `${prefix}/items`,
      async handler(request) {
        const validated = validateListQuery(request.query);
        if (!validated.ok) return response(400, { error: validated.error });
        return store().list(validated.value);
      },
    },
    {
      method: "POST",
      path: `${prefix}/items`,
      async handler(request) {
        const validated = validateCreateScheduleItem(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        return response(201, await store().create(validated.value));
      },
    },
    {
      method: "GET",
      path: `${prefix}/items/:id`,
      async handler(request) {
        const invalid = invalidItemId(request);
        if (invalid) return invalid;
        const item = await store().get(request.params.id);
        return item ?? response(404, {
          error: `Schedule item ${request.params.id} not found`,
        });
      },
    },
    {
      method: "PATCH",
      path: `${prefix}/items/:id`,
      async handler(request) {
        const invalid = invalidItemId(request);
        if (invalid) return invalid;
        const validated = validateEditScheduleItem(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        try {
          const current = await store().get(request.params.id);
          if (!current) throw new ScheduleNotFoundError(request.params.id);
          if (
            current.version === validated.value.expectedVersion &&
            current.status === "scheduled"
          ) {
            const start = validated.value.changes.scheduledStartAt ??
              new Date(current.scheduledStartAt);
            const end = Object.hasOwn(validated.value.changes, "scheduledEndAt")
              ? validated.value.changes.scheduledEndAt ?? null
              : current.scheduledEndAt
                ? new Date(current.scheduledEndAt)
                : null;
            const intervalError = validateScheduleInterval(start, end);
            if (intervalError) return response(400, { error: intervalError });
          }
          return await store().edit(
            request.params.id,
            validated.value.expectedVersion,
            validated.value.changes
          );
        } catch (error) {
          return scheduleError(error);
        }
      },
    },
    {
      method: "POST",
      path: `${prefix}/items/:id/confirm-start`,
      async handler(request) {
        const invalid = invalidItemId(request);
        if (invalid) return invalid;
        const validated = validateExpectedVersionBody(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        try {
          return await store().confirmStart(
            request.params.id,
            validated.value.expectedVersion
          );
        } catch (error) {
          return scheduleError(error);
        }
      },
    },
    {
      method: "POST",
      path: `${prefix}/items/:id/snooze`,
      async handler(request) {
        const invalid = invalidItemId(request);
        if (invalid) return invalid;
        const validated = validateSnoozeBody(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        try {
          return await store().snooze(
            request.params.id,
            validated.value.expectedVersion,
            validated.value.nextReminderAt
          );
        } catch (error) {
          return scheduleError(error);
        }
      },
    },
    ...(["complete", "cancel"] as const).map((action): PluginRoute => ({
      method: "POST",
      path: `${prefix}/items/:id/${action}`,
      async handler(request) {
        const invalid = invalidItemId(request);
        if (invalid) return invalid;
        const validated = validateExpectedVersionBody(request.body);
        if (!validated.ok) return response(400, { error: validated.error });
        try {
          return action === "complete"
            ? await store().complete(
                request.params.id,
                validated.value.expectedVersion
              )
            : await store().cancel(
                request.params.id,
                validated.value.expectedVersion
              );
        } catch (error) {
          return scheduleError(error);
        }
      },
    })),
    {
      method: "GET",
      path: `${prefix}/reminders`,
      async handler(request) {
        const validated = validateReminderQuery(request.query);
        if (!validated.ok) return response(400, { error: validated.error });
        return store().listReminders(validated.value);
      },
    },
  ];
}
