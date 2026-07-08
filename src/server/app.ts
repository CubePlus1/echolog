import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadConfig } from "../core/config.js";
import {
  RecordNotFoundError,
  InvalidStateError,
  AmbiguousActiveError,
} from "../core/recorder.js";
import { RuleNotFoundError } from "../core/screen.js";
import { recordRoutes } from "./routes/records.js";
import { noteRoutes } from "./routes/notes.js";
import { summaryRoutes } from "./routes/summary.js";
import { reportRoutes } from "./routes/reports.js";
import { screenRoutes } from "./routes/screen.js";
import { startScheduler, stopScheduler } from "../core/scheduler.js";
import { startTracker, stopTracker } from "../core/tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

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
    if (error instanceof RecordNotFoundError) {
      return reply.code(404).send({ error: error.message });
    }
    if (error instanceof RuleNotFoundError) {
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
  await app.register(screenRoutes);

  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  const webRoot = join(__dirname, "../../web");
  if (existsSync(join(webRoot, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

async function main() {
  const config = loadConfig();
  const app = await buildApp();

  startScheduler();
  startTracker();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(
      `EchoLog server running on http://${config.server.host}:${config.server.port}`
    );
  } catch (err) {
    app.log.error(err);
    stopScheduler();
    await stopTracker();
    process.exit(1);
  }

  const shutdown = async () => {
    stopScheduler();
    await stopTracker();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
