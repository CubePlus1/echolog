import type { FastifyInstance } from "fastify";
import {
  createRule,
  deleteRule,
  getDailyScreen,
  listRules,
} from "../../core/screen.js";
import { localDateStr } from "../../core/utils.js";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ruleSchema = {
  body: {
    type: "object",
    required: ["appMatch", "label"],
    properties: {
      appMatch: { type: "string", minLength: 1, maxLength: 200 },
      label: { type: "string", minLength: 1, maxLength: 50 },
      startTime: { type: "string", pattern: TIME_RE.source },
      endTime: { type: "string", pattern: TIME_RE.source },
      weekdays: {
        type: "array",
        items: { type: "integer", minimum: 0, maximum: 6 },
        maxItems: 7,
      },
      priority: { type: "integer", minimum: -1000, maximum: 1000 },
    },
  },
} as const;

function toMinute(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export async function screenRoutes(app: FastifyInstance) {
  app.get("/api/screen/today", async (_req, reply) => {
    return reply.send(await getDailyScreen(localDateStr()));
  });

  app.get("/api/screen/daily/:date", async (req, reply) => {
    const { date } = req.params as { date: string };
    if (!DATE_RE.test(date)) {
      return reply.code(400).send({ error: "date must be YYYY-MM-DD" });
    }
    return reply.send(await getDailyScreen(date));
  });

  app.get("/api/screen/rules", async (_req, reply) => {
    return reply.send(await listRules());
  });

  app.post("/api/screen/rules", { schema: ruleSchema }, async (req, reply) => {
    const body = req.body as {
      appMatch: string;
      label: string;
      startTime?: string;
      endTime?: string;
      weekdays?: number[];
      priority?: number;
    };
    if ((body.startTime == null) !== (body.endTime == null)) {
      return reply
        .code(400)
        .send({ error: "startTime and endTime must be provided together" });
    }
    if (
      body.startTime != null &&
      body.endTime != null &&
      body.startTime === body.endTime
    ) {
      return reply
        .code(400)
        .send({ error: "startTime and endTime must differ (omit both for all-day)" });
    }
    const rule = await createRule({
      appMatch: body.appMatch.trim(),
      label: body.label.trim(),
      startMinute: body.startTime != null ? toMinute(body.startTime) : null,
      endMinute: body.endTime != null ? toMinute(body.endTime) : null,
      weekdays: body.weekdays && body.weekdays.length ? body.weekdays : null,
      priority: body.priority ?? 0,
    });
    return reply.code(201).send(rule);
  });

  app.delete("/api/screen/rules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await deleteRule(id));
  });
}
