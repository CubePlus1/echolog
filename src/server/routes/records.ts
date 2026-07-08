import type { FastifyInstance } from "fastify";
import {
  startRecord,
  stopRecord,
  pauseRecord,
  resumeRecord,
  cancelRecord,
  editRecord,
  backfillRecord,
  getActiveRecordsEnriched,
  resolveSoleActiveRecord,
  getRecord,
  getRecords,
  stopAllActive,
} from "../../core/recorder.js";

const startSchema = {
  body: {
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string", minLength: 1 },
      type: { type: "string", enum: ["learning", "project", "task"] },
      tags: { type: "array", items: { type: "string" } },
      project: { type: "string" },
      source: { type: "string" },
    },
  },
} as const;

const patchSchema = {
  body: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["stop", "pause", "resume", "edit"] },
      result: { type: "string" },
      title: { type: "string", minLength: 1 },
      type: { type: "string", enum: ["learning", "project", "task"] },
      tags: { type: "array", items: { type: "string" } },
      project: { type: "string" },
    },
  },
} as const;

const backfillSchema = {
  body: {
    type: "object",
    required: ["title", "startAt", "durationMinutes"],
    properties: {
      title: { type: "string", minLength: 1 },
      type: { type: "string", enum: ["learning", "project", "task"] },
      tags: { type: "array", items: { type: "string" } },
      project: { type: "string" },
      startAt: { type: "string", format: "date-time" },
      durationMinutes: { type: "number", minimum: 1 },
      result: { type: "string" },
      source: { type: "string" },
    },
  },
} as const;

export async function recordRoutes(app: FastifyInstance) {
  // W-8 fix: register static routes before parametric ones
  app.get("/api/records/active", async (_req, reply) => {
    return reply.send(await getActiveRecordsEnriched());
  });

  app.patch(
    "/api/records/active",
    { schema: patchSchema },
    async (req, reply) => {
      const body = req.body as {
        action: string;
        result?: string;
        title?: string;
        type?: string;
        tags?: string[];
        project?: string;
      };
      const record = await resolveSoleActiveRecord(body.action as any);

      switch (body.action) {
        case "stop":
          return reply.send(
            await stopRecord({ id: record.id, result: body.result })
          );
        case "pause":
          return reply.send(await pauseRecord(record.id));
        case "resume":
          return reply.send(await resumeRecord(record.id));
        case "edit":
          return reply.send(
            await editRecord(record.id, {
              title: body.title,
              type: body.type as any,
              tags: body.tags,
              project: body.project,
              result: body.result,
            })
          );
        default:
          return reply
            .code(400)
            .send({ error: `Unknown action: ${body.action}` });
      }
    }
  );

  app.post("/api/records", { schema: startSchema }, async (req, reply) => {
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

  app.patch(
    "/api/records/:id",
    { schema: patchSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        action: string;
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
          return reply
            .code(400)
            .send({ error: `Unknown action: ${body.action}` });
      }
    }
  );

  // W-7: using PATCH+cancel would be more RESTful, but keeping DELETE for simplicity
  app.delete("/api/records/active", async (_req, reply) => {
    const record = await resolveSoleActiveRecord("cancel");
    return reply.send(await cancelRecord(record.id));
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

    return reply.send(
      await getRecords({
        date: query.date,
        since: query.since,
        project: query.project,
        type: query.type,
        limit: query.limit ? parseInt(query.limit) : undefined,
      })
    );
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

  app.post(
    "/api/records/backfill",
    { schema: backfillSchema },
    async (req, reply) => {
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
    }
  );
}
