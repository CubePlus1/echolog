import type { FastifyInstance } from "fastify";
import { addNote, getRecordNotes } from "../../core/recorder.js";

export async function noteRoutes(app: FastifyInstance) {
  app.post("/api/records/:id/notes", async (req, reply) => {
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
  });

  app.get("/api/records/:id/notes", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(await getRecordNotes(id));
  });
}
