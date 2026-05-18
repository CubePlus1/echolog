import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadConfig } from "../core/config.js";
import { recordRoutes } from "./routes/records.js";
import { noteRoutes } from "./routes/notes.js";
import { summaryRoutes } from "./routes/summary.js";
import { reportRoutes } from "./routes/reports.js";
import { startScheduler, stopScheduler } from "../core/scheduler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  await app.register(recordRoutes);
  await app.register(noteRoutes);
  await app.register(summaryRoutes);
  await app.register(reportRoutes);

  app.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  const webDist = join(__dirname, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile("index.html");
    });
  }

  return app;
}

async function main() {
  const config = loadConfig();
  const app = await buildApp();

  startScheduler();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(
      `ClawLog server running on http://${config.server.host}:${config.server.port}`
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

main();
