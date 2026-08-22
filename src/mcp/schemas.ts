import * as z from "zod/v4";

export const localDateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "date must use YYYY-MM-DD"
);

export const recordTypeSchema = z.enum(["learning", "project", "task"]);
export const recordStatusSchema = z.enum(["running", "paused", "done", "cancelled"]);
export const noteTypeSchema = z.enum(["note", "blocker", "next"]);

export const recordSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: recordTypeSchema,
  tags: z.array(z.string()),
  project: z.string().nullable(),
  parentId: z.string().nullable(),
  startAt: z.string(),
  endAt: z.string().nullable(),
  status: recordStatusSchema,
  durationSeconds: z.number(),
  result: z.string().nullable(),
  source: z.string(),
}).passthrough();

export const noteSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  content: z.string(),
  type: noteTypeSchema,
  createdAt: z.string(),
}).passthrough();

export const statusSchema = z.object({
  totalSeconds: z.number(),
  recordCount: z.number(),
  byType: z.record(z.string(), z.number()),
  active: z.array(recordSchema),
}).passthrough();

export const recordsSchema = z.object({
  records: z.array(recordSchema),
});

export const subtasksSchema = z.object({
  parent: recordSchema,
  subtasks: z.array(recordSchema),
  progress: z.object({
    total: z.number(),
    done: z.number(),
    active: z.number(),
    cancelled: z.number(),
    percent: z.number(),
  }).passthrough(),
}).passthrough();

export const reportSchema = z.object({
  date: localDateSchema,
  markdown: z.string(),
}).passthrough();

export const screenTimeSchema = z.object({
  date: localDateSchema,
  totalSeconds: z.number(),
  byLabel: z.array(z.object({
    label: z.string(),
    seconds: z.number(),
  }).passthrough()),
  apps: z.array(z.object({
    appName: z.string(),
    bundleId: z.string(),
    seconds: z.number(),
  }).passthrough()),
  segments: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

export const screenUnderstandingInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(5),
});

export const screenUnderstandingObservationSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  completedAt: z.string(),
  providerProfileId: z.string(),
  model: z.string(),
  summary: z.string(),
  activity: z.string(),
  confidence: z.number().min(0).max(1),
  sensitive: z.boolean(),
  apps: z.array(z.string()),
  latencyMs: z.number().nonnegative(),
  costMicros: z.number().int().nonnegative().nullable(),
}).passthrough();

export const screenUnderstandingSchema = z.object({
  observations: z.array(screenUnderstandingObservationSchema),
});

export const emptyInputSchema = z.object({});

export const listRecordsInputSchema = z.object({
  date: localDateSchema.optional().describe("Local date; when set, the API ignores other filters"),
  since: z.string().min(1).optional().describe("ISO timestamp or date lower bound"),
  project: z.string().min(1).optional(),
  type: recordTypeSchema.optional(),
  parentId: z.string().min(1).optional().describe("Parent record id, or root for root records"),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const recordIdInputSchema = z.object({
  id: z.string().min(1).describe("EchoLog record id"),
});

export const startRecordInputSchema = z.object({
  title: z.string().min(1),
  type: recordTypeSchema.default("task"),
  tags: z.array(z.string().min(1)).default([]),
  project: z.string().min(1).optional(),
  parentId: z.string().min(1).optional(),
});

export const controlRecordInputSchema = z.object({
  id: z.string().min(1).optional().describe("Omit to use the server-side unique active-record resolver"),
  action: z.enum(["stop", "pause", "resume"]),
  result: z.string().optional().describe("Completion result; valid only when action is stop"),
}).superRefine((value, context) => {
  if (value.result !== undefined && value.action !== "stop") {
    context.addIssue({
      code: "custom",
      path: ["result"],
      message: "result is valid only when action is stop",
    });
  }
});

export const addNoteInputSchema = z.object({
  id: z.string().min(1).optional().describe("Omit to use the server-side unique active-record resolver"),
  content: z.string().min(1),
  type: noteTypeSchema.default("note"),
});

export const dateInputSchema = z.object({
  date: localDateSchema.optional(),
});
