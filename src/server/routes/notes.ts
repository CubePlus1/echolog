import type { FastifyInstance } from "fastify";
import {
  addNote,
  getRecordNotes,
  resolveSoleActiveRecord,
} from "../../core/recorder.js";

const noteSchema = {
  body: {
    type: "object",
    required: ["content"],
    properties: {
      content: { type: "string", minLength: 1 },
      type: { type: "string", enum: ["note", "blocker", "next"] },
    },
  },
} as const;

export async function noteRoutes(app: FastifyInstance) {
  app.post(
    "/api/records/active/notes",
    { schema: noteSchema },
    async (req, reply) => {
      const body = req.body as {
        content: string;
        type?: "note" | "blocker" | "next";
      };
      const record = await resolveSoleActiveRecord("note");
      const note = await addNote({
        recordId: record.id,
        content: body.content,
        type: body.type,
      });
      return reply.code(201).send(note);
    }
  );

  app.post(
    "/api/records/:id/notes",
    { schema: noteSchema },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as {
        content: string;
        type?: "note" | "blocker" | "next";
      };
      const note = await addNote({
        recordId: id,
        content: body.content,
        type: body.type,
      });
      return reply.code(201).send(note);
    }
  );

  app.get("/api/records/:id/notes", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await getRecordNotes(id));
  });
}
