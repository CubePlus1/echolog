import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { PluginError } from "@echolog/plugin-sdk";
import { loadConfig } from "../core/config.js";
import { createPluginHost } from "../core/plugins/create.js";
import { setCurrentPluginHost } from "../core/plugins/current.js";
import { bundledPluginWebAssets } from "../core/plugins/registry.js";
import {
  RecordNotFoundError,
  InvalidStateError,
  AmbiguousActiveError,
} from "../core/recorder.js";
import { recordRoutes } from "./routes/records.js";
import { noteRoutes } from "./routes/notes.js";
import { summaryRoutes } from "./routes/summary.js";
import { reportRoutes } from "./routes/reports.js";
import { pluginRoutes } from "./routes/plugins.js";
import { startScheduler, stopScheduler } from "../core/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger: true });
  const pluginHost = createPluginHost(config, app.log);
  await pluginHost.initialize();
  setCurrentPluginHost(pluginHost);

  await app.register(cors, {
    origin: config.server.corsOrigins ?? false,
  });

  // API key auth: only guards /api/*; loopback (本机 CLI / 本机浏览器) 豁免
  if (config.server.apiKey) {
    const isLoopback = (ip: string) =>
      ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    app.addHook("onRequest", async (req, reply) => {
      if (!req.url.startsWith("/api/")) return;
      if (req.url === "/api/health") return;
      if (isLoopback(req.ip)) return;
      const key =
        req.headers["x-api-key"] ??
        (req.query as any)?.apiKey;
      if (key !== config.server.apiKey) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
    });
  }

  // H-4 fix: error handler maps domain errors to HTTP status codes
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof PluginError) {
      return reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        pluginId: error.pluginId,
        state: error.state,
      });
    }
    if (error instanceof RecordNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof InvalidStateError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof AmbiguousActiveError) {
      return reply
        .code(409)
        .send({ error: error.message, candidates: error.candidates });
    }
    if (error instanceof Error && "validation" in error) {
      return reply.code(400).send({ error: error.message });
    }
    app.log.error(error);
    const msg =
      error instanceof Error ? error.message : "Internal server error";
    return reply.code(500).send({ error: msg });
  });

  await app.register(recordRoutes);
  await app.register(noteRoutes);
  await app.register(summaryRoutes);
  await app.register(reportRoutes);
  await pluginRoutes(app, pluginHost);

  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  const webRoot = join(__dirname, "../../web");
  const hasWebUi = Boolean(
    config.server.serveWeb && existsSync(join(webRoot, "index.html"))
  );

  if (hasWebUi) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
    });
    for (const asset of bundledPluginWebAssets) {
      await app.register(fastifyStatic, {
        root: join(__dirname, "../../plugins", asset.root),
        prefix: asset.prefix,
        decorateReply: false,
      });
    }
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    if (hasWebUi) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send();
  });

  app.addHook("onClose", async () => {
    await pluginHost.stop();
    setCurrentPluginHost(null);
  });

  return app;
}

async function main() {
  const config = loadConfig();
  const app = await buildApp();

  startScheduler();
  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(
      `EchoLog server running on http://${config.server.host}:${config.server.port}`
    );
  } catch (err) {
    app.log.error(err);
    stopScheduler();
    process.exit(1);
  }

  const shutdown = async () => {
    stopScheduler();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  void main();
}
