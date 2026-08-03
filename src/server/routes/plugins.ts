import {
  isPluginHttpResponse,
  type PluginHttpRequest,
} from "@echolog/plugin-sdk";
import type { FastifyInstance } from "fastify";
import type { PluginHost } from "../../core/plugins/host.js";

function toPluginRequest(req: {
  params: unknown;
  query: unknown;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}): PluginHttpRequest {
  return {
    params: (req.params ?? {}) as Record<string, string>,
    query: req.query,
    body: req.body,
    headers: req.headers,
  };
}

export async function pluginRoutes(app: FastifyInstance, host: PluginHost) {
  app.get("/api/plugins", async () => ({ plugins: host.list() }));

  app.get("/api/plugins/doctor", async (_req, reply) => {
    const result = await host.doctor();
    if (result.ok) return reply.send(result);
    return reply.code(503).send({
      error: "One or more enabled plugin checks failed",
      ...result,
    });
  });

  for (const { pluginId, route } of host.routes()) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (req, reply) => {
        host.assertReady(pluginId);
        const controller = new AbortController();
        req.raw.once("close", () => controller.abort());
        const result = await route.handler(
          toPluginRequest(req as Parameters<typeof toPluginRequest>[0]),
          controller.signal
        );
        if (isPluginHttpResponse(result)) {
          return reply.code(result.statusCode ?? 200).send(result.body);
        }
        return reply.send(result);
      },
    });
  }
}
