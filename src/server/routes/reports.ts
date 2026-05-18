import type { FastifyInstance } from "fastify";
import { generateDailyReport } from "../../core/reporter.js";
import { syncDaily } from "../../core/syncer.js";

export async function reportRoutes(app: FastifyInstance) {
  app.post("/api/reports/daily", async (req, reply) => {
    const body = (req.body as { date?: string }) ?? {};
    const date = body.date ?? (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    const markdown = await generateDailyReport(date);
    return reply.send({ date, markdown });
  });

  app.post("/api/sync", async (req, reply) => {
    const body = (req.body as { date?: string }) ?? {};
    const date = body.date ?? (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
    const path = await syncDaily(date);
    return reply.send({ date, path });
  });
}
