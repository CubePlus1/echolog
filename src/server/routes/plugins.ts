import {
  isPluginHttpResponse,
  type PluginHttpRequest,
} from "@echolog/plugin-sdk";
import type { FastifyInstance } from "fastify";
import type { PluginHost } from "../../core/plugins/host.js";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address);
}

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
        if (route.localOnly && !isLoopbackAddress(req.ip)) {
          return reply.code(403).send({
            error: "This operation is only available from localhost",
            code: "PLUGIN_LOCAL_ONLY",
            pluginId,
          });
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        const abortDisconnectedReply = () => {
          if (!reply.raw.writableEnded) abort();
        };
        // IncomingMessage "close" means the request body has finished on
        // current Node releases; it does not mean the client disconnected.
        // Aborting on it cancels any helper command immediately after POST.
        req.raw.once("aborted", abort);
        reply.raw.once("close", abortDisconnectedReply);
        let result;
        try {
          result = await route.handler(
            toPluginRequest(req as Parameters<typeof toPluginRequest>[0]),
            controller.signal
          );
        } finally {
          req.raw.off("aborted", abort);
          reply.raw.off("close", abortDisconnectedReply);
        }
        if (isPluginHttpResponse(result)) {
          return reply.code(result.statusCode ?? 200).send(result.body);
        }
        return reply.send(result);
      },
    });
  }
}
