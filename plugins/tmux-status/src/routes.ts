import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import type { TmuxStatusAdapter } from "./adapter.js";
import type { TmuxObservationStore } from "./store.js";

export interface TmuxServices {
  adapter: TmuxStatusAdapter;
  store: TmuxObservationStore;
}

function response(statusCode: number, body: unknown): PluginHttpResponse {
  return { statusCode, body };
}

export function createTmuxRoutes(
  services: () => TmuxServices
): PluginRoute[] {
  return [
    {
      method: "GET",
      path: "/api/plugins/tmux-status/status",
      async handler(_request, signal) {
        const { adapter, store } = services();
        const snapshot = await adapter.status(signal);
        await store.observe(snapshot);
        return snapshot;
      },
    },
    {
      method: "POST",
      path: "/api/plugins/tmux-status/mark",
      async handler(request: PluginHttpRequest, signal) {
        if (!request.body || typeof request.body !== "object") {
          return response(400, { error: "body must be an object" });
        }
        const body = request.body as Record<string, unknown>;
        if (
          typeof body.target !== "string" ||
          body.target.length < 1 ||
          body.target.length > 200
        ) {
          return response(400, { error: "target must be a non-empty string" });
        }
        if (
          body.state !== "active" &&
          body.state !== "inactive" &&
          body.state !== "auto"
        ) {
          return response(400, {
            error: "state must be active, inactive, or auto",
          });
        }
        if (
          body.note != null &&
          (typeof body.note !== "string" || body.note.length > 500)
        ) {
          return response(400, { error: "note must be at most 500 characters" });
        }
        return services().adapter.mark(
          body.target,
          body.state,
          body.note as string | undefined,
          signal
        );
      },
    },
    {
      method: "GET",
      path: "/api/plugins/tmux-status/doctor",
      async handler() {
        return services().adapter.doctor();
      },
    },
  ];
}
