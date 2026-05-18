import type { FastifyInstance } from "fastify";
import { generateDailyReport } from "../../core/reporter.js";
import { syncDaily } from "../../core/syncer.js";

export async function reportRoutes(app: FastifyInstance) {
  app.post("/api/reports/daily", async (req, reply) => {
    const body = (req.body as { date?: string }) ?? {};
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const markdown = await generateDailyReport(date);
    return reply.send({ date, markdown });
  });

  app.post("/api/sync", async (req, reply) => {
    const body = (req.body as { date?: string }) ?? {};
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const path = await syncDaily(date);
    return reply.send({ date, path });
  });
}
