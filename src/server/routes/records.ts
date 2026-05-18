import type { FastifyInstance } from "fastify";
import {
  startRecord,
  stopRecord,
  pauseRecord,
  resumeRecord,
  cancelRecord,
  editRecord,
  backfillRecord,
  getActiveRecords,
  getRecord,
  getRecords,
  getRecordsByDate,
  stopAllActive,
} from "../../core/recorder.js";

export async function recordRoutes(app: FastifyInstance) {
  app.post("/api/records", async (req, reply) => {
    const body = req.body as {
      title: string;
      type?: string;
      tags?: string[];
      project?: string;
      source?: string;
    };
    const record = await startRecord({
      title: body.title,
      type: body.type as any,
      tags: body.tags,
      project: body.project,
      source: (body.source as any) ?? "api",
    });
    return reply.code(201).send(record);
  });

  app.patch("/api/records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      action: "stop" | "pause" | "resume" | "edit";
      result?: string;
      title?: string;
      type?: string;
      tags?: string[];
      project?: string;
    };

    switch (body.action) {
      case "stop":
        return reply.send(await stopRecord({ id, result: body.result }));
      case "pause":
        return reply.send(await pauseRecord(id));
      case "resume":
        return reply.send(await resumeRecord(id));
      case "edit":
        return reply.send(
          await editRecord(id, {
            title: body.title,
            type: body.type as any,
            tags: body.tags,
            project: body.project,
            result: body.result,
          })
        );
      default:
        return reply.code(400).send({ error: `Unknown action: ${body.action}` });
    }
  });

  app.delete("/api/records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await cancelRecord(id));
  });

  app.get("/api/records", async (req, reply) => {
    const query = req.query as {
      date?: string;
      since?: string;
      project?: string;
      type?: string;
      limit?: string;
    };

    if (query.date) {
      return reply.send(await getRecordsByDate(query.date));
    }
    return reply.send(
      await getRecords({
        since: query.since,
        project: query.project,
        type: query.type,
        limit: query.limit ? parseInt(query.limit) : undefined,
      })
    );
  });

  app.get("/api/records/active", async (_req, reply) => {
    return reply.send(await getActiveRecords());
  });

  app.get("/api/records/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await getRecord(id);
    if (!record) return reply.code(404).send({ error: "Not found" });
    return reply.send(record);
  });

  app.post("/api/records/stop-all", async (_req, reply) => {
    return reply.send(await stopAllActive());
  });

  app.post("/api/records/backfill", async (req, reply) => {
    const body = req.body as {
      title: string;
      type?: string;
      tags?: string[];
      project?: string;
      startAt: string;
      durationMinutes: number;
      result?: string;
      source?: string;
    };
    const record = await backfillRecord({
      title: body.title,
      type: body.type as any,
      tags: body.tags,
      project: body.project,
      startAt: new Date(body.startAt),
      durationMinutes: body.durationMinutes,
      result: body.result,
      source: (body.source as any) ?? "api",
    });
    return reply.code(201).send(record);
  });
}
