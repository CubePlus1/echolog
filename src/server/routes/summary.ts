import type { FastifyInstance } from "fastify";
import { getTodaySummary, getRecordsByDate } from "../../core/recorder.js";

export async function summaryRoutes(app: FastifyInstance) {
  app.get("/api/summary/today", async (_req, reply) => {
    return reply.send(await getTodaySummary());
  });

  app.get("/api/summary/daily/:date", async (req, reply) => {
    const { date } = req.params as { date: string };
    const records = await getRecordsByDate(date);
    let totalSeconds = 0;
    const byType = { learning: 0, project: 0, task: 0 };
    for (const r of records) {
      if (r.status === "cancelled") continue;
      totalSeconds += r.durationSeconds;
      if (r.type in byType) {
        byType[r.type as keyof typeof byType] += r.durationSeconds;
      }
    }
    return reply.send({
      date,
      totalSeconds,
      recordCount: records.filter((r) => r.status !== "cancelled").length,
      byType,
      records,
    });
  });
}
