import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { api, patch, post } from "../client/api.js";
import { executeTool, wrapRecords, wrapScreenUnderstanding } from "./result.js";
import {
  addNoteInputSchema,
  controlRecordInputSchema,
  dateInputSchema,
  emptyInputSchema,
  listRecordsInputSchema,
  noteSchema,
  recordIdInputSchema,
  recordSchema,
  recordsSchema,
  reportSchema,
  screenUnderstandingInputSchema,
  screenUnderstandingSchema,
  screenTimeSchema,
  startRecordInputSchema,
  statusSchema,
  subtasksSchema,
} from "./schemas.js";

export const MCP_TOOL_NAMES = [
  "get_status",
  "list_records",
  "get_subtasks",
  "start_record",
  "control_record",
  "add_note",
  "generate_report",
  "get_screen_time",
  "get_screen_understanding",
] as const;

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const CONTROL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

function recordsPath(filters: {
  date?: string;
  since?: string;
  project?: string;
  type?: string;
  parentId?: string;
  limit?: number;
}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `/api/records?${suffix}` : "/api/records";
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "echolog", version: "0.1.0" },
    {
      instructions: "Use EchoLog tools for explicit activity tracking and evidence-based review. Preserve record ids and never guess among ambiguous active-record candidates.",
    }
  );

  server.registerTool(
    "get_status",
    {
      title: "Get EchoLog Status",
      description: "Return today's EchoLog summary and all running or paused records.",
      inputSchema: emptyInputSchema,
      outputSchema: statusSchema,
      annotations: READ_ONLY,
    },
    async () => executeTool(() => api<unknown>("/api/summary/today"))
  );

  server.registerTool(
    "list_records",
    {
      title: "List EchoLog Records",
      description: "List EchoLog records with optional date, time, project, type, parent, and limit filters.",
      inputSchema: listRecordsInputSchema,
      outputSchema: recordsSchema,
      annotations: READ_ONLY,
    },
    async (filters) => executeTool(
      () => api<unknown>(recordsPath(filters)),
      wrapRecords
    )
  );

  server.registerTool(
    "get_subtasks",
    {
      title: "Get EchoLog Subtasks",
      description: "Return a parent record, its direct subtasks, and server-calculated progress.",
      inputSchema: recordIdInputSchema,
      outputSchema: subtasksSchema,
      annotations: READ_ONLY,
    },
    async ({ id }) => executeTool(() => api<unknown>(`/api/records/${encodeURIComponent(id)}/subtasks`))
  );

  server.registerTool(
    "start_record",
    {
      title: "Start EchoLog Record",
      description: "Start one explicit EchoLog work record and return its stable record id.",
      inputSchema: startRecordInputSchema,
      outputSchema: recordSchema,
      annotations: CREATE,
    },
    async ({ title, type, tags, project, parentId }) => executeTool(() => post<unknown>(
      "/api/records",
      { title, type, tags, project, parentId, source: "api" }
    ))
  );

  server.registerTool(
    "control_record",
    {
      title: "Control EchoLog Record",
      description: "Stop, pause, or resume a record. Omit id only when the server can resolve one unique active record; 409 responses include candidates.",
      inputSchema: controlRecordInputSchema,
      outputSchema: recordSchema,
      annotations: CONTROL,
    },
    async ({ id, action, result }) => executeTool(() => patch<unknown>(
      id ? `/api/records/${encodeURIComponent(id)}` : "/api/records/active",
      { action, result }
    ))
  );

  server.registerTool(
    "add_note",
    {
      title: "Add EchoLog Note",
      description: "Append a note, blocker, or next action to a record. Omit id only for the server-side unique active-record resolver.",
      inputSchema: addNoteInputSchema,
      outputSchema: noteSchema,
      annotations: CREATE,
    },
    async ({ id, content, type }) => executeTool(() => post<unknown>(
      id
        ? `/api/records/${encodeURIComponent(id)}/notes`
        : "/api/records/active/notes",
      { content, type }
    ))
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate EchoLog Daily Report",
      description: "Generate daily report Markdown without synchronizing it to a directory.",
      inputSchema: dateInputSchema,
      outputSchema: reportSchema,
      annotations: READ_ONLY,
    },
    async ({ date }) => executeTool(() => post<unknown>("/api/reports/daily", { date }))
  );

  server.registerTool(
    "get_screen_time",
    {
      title: "Get EchoLog Screen Time",
      description: "Return today's or a specified local date's screen-time usage. Disabled or degraded plugin states are returned as structured tool errors.",
      inputSchema: dateInputSchema,
      outputSchema: screenTimeSchema,
      annotations: READ_ONLY,
    },
    async ({ date }) => executeTool(() => api<unknown>(
      date ? `/api/screen/daily/${encodeURIComponent(date)}` : "/api/screen/today"
    ))
  );

  server.registerTool(
    "get_screen_understanding",
    {
      title: "Get AI Screen Understanding",
      description: "Return recent structured AI screen-understanding observations. This is read-only and never returns raw screenshots or API keys.",
      inputSchema: screenUnderstandingInputSchema,
      outputSchema: screenUnderstandingSchema,
      annotations: READ_ONLY,
    },
    async ({ limit }) => executeTool(
      () => api<unknown>(`/api/plugins/screen-time/understanding/history?limit=${limit}`),
      wrapScreenUnderstanding
    )
  );

  return server;
}
