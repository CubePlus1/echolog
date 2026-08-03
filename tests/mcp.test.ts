import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_NAMES } from "../src/mcp/server.js";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxPath = join(repoRoot, "node_modules/.bin/tsx");
const cliPath = join(repoRoot, "src/cli/index.ts");

const baseRecord = {
  id: "record-1",
  title: "MCP smoke",
  type: "task",
  tags: ["mcp"],
  project: "echolog",
  parentId: null,
  startAt: "2026-08-03T08:00:00.000Z",
  endAt: null,
  status: "running",
  durationSeconds: 0,
  result: null,
  source: "api",
  createdAt: "2026-08-03T08:00:00.000Z",
  updatedAt: "2026-08-03T08:00:00.000Z",
};

type CapturedRequest = {
  method: string;
  path: string;
  body?: unknown;
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function structured(result: CallToolResult): Record<string, unknown> {
  assert.ok(result.structuredContent);
  return result.structuredContent;
}

function toolError(result: CallToolResult): Record<string, unknown> {
  assert.equal(result.isError, true);
  const block = result.content[0];
  assert.equal(block?.type, "text");
  return JSON.parse(block.type === "text" ? block.text : "") as Record<string, unknown>;
}

function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(tsxPath, [cliPath, ...args], { cwd: repoRoot }, (error, stdout, stderr) => {
      resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

test("el mcp help documents the stdio entry point", async () => {
  const result = await runCli(["mcp", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /stdio/);
  assert.match(result.stdout, /stdout.*MCP/);
});

test("MCP adapter stays an HTTP thin client", async () => {
  const mcpDir = join(repoRoot, "src/mcp");
  const files = (await readdir(mcpDir)).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(join(mcpDir, file), "utf8");
    assert.doesNotMatch(source, /from ["']\.\.\/(?:core|db|plugins)\//);
  }
});

test("stdio MCP exposes typed tools and preserves EchoLog HTTP results", { timeout: 30_000 }, async () => {
  const requests: CapturedRequest[] = [];
  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const body = await readBody(request);
    requests.push({ method: request.method ?? "GET", path: `${url.pathname}${url.search}`, body });

    if (request.method === "GET" && url.pathname === "/api/summary/today") {
      return sendJson(response, 200, {
        totalSeconds: 0,
        recordCount: 1,
        byType: { learning: 0, project: 0, task: 1 },
        active: [baseRecord],
      });
    }
    if (request.method === "GET" && url.pathname === "/api/records") {
      return sendJson(response, 200, [baseRecord]);
    }
    if (request.method === "GET" && url.pathname === "/api/records/missing/subtasks") {
      return sendJson(response, 404, { error: "Record not found: missing" });
    }
    if (request.method === "GET" && url.pathname === "/api/records/parent/subtasks") {
      return sendJson(response, 200, {
        parent: { ...baseRecord, id: "parent" },
        subtasks: [baseRecord],
        progress: { total: 1, done: 0, active: 1, cancelled: 0, percent: 0 },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/records") {
      return sendJson(response, 201, baseRecord);
    }
    if (request.method === "POST" && url.pathname === "/api/records/record-1/notes") {
      return sendJson(response, 201, {
        id: "note-1",
        recordId: "record-1",
        content: "blocked on review",
        type: "blocker",
        createdAt: "2026-08-03T08:01:00.000Z",
      });
    }
    if (request.method === "PATCH" && url.pathname === "/api/records/record-1") {
      return sendJson(response, 200, {
        ...baseRecord,
        status: "done",
        endAt: "2026-08-03T08:02:00.000Z",
        durationSeconds: 120,
        result: "verified",
      });
    }
    if (request.method === "PATCH" && url.pathname === "/api/records/active") {
      return sendJson(response, 409, {
        error: "Multiple active records",
        candidates: [
          { id: "record-1", title: "MCP smoke", status: "running" },
          { id: "record-2", title: "Other work", status: "paused" },
        ],
      });
    }
    if (request.method === "POST" && url.pathname === "/api/reports/daily") {
      return sendJson(response, 200, {
        date: "2026-08-03",
        markdown: "# 2026-08-03\n",
      });
    }
    if (request.method === "GET" && url.pathname === "/api/screen/daily/2026-08-03") {
      return sendJson(response, 503, {
        error: "screen-time unavailable",
        code: "PLUGIN_DEGRADED",
        pluginId: "screen-time",
        state: "degraded",
      });
    }
    return sendJson(response, 404, { error: "Not found" });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  const tempDir = await mkdtemp(join(tmpdir(), "echolog-mcp-test-"));
  const configPath = join(tempDir, "config.yaml");
  await writeFile(configPath, [
    "server:",
    `  port: ${address.port}`,
    "  host: localhost",
    "",
  ].join("\n"));

  const transport = new StdioClientTransport({
    command: tsxPath,
    args: [cliPath, "mcp"],
    cwd: tempDir,
    env: {
      ...getDefaultEnvironment(),
      ECHOLOG_CONFIG_PATH: configPath,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "echolog-test", version: "1.0.0" });
  let httpClosed = false;

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), MCP_TOOL_NAMES);
    for (const tool of listed.tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.outputSchema?.type, "object");
      assert.equal(tool.annotations?.openWorldHint, false);
    }

    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    for (const name of ["get_status", "list_records", "get_subtasks", "generate_report", "get_screen_time"]) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, true);
      assert.equal(byName.get(name)?.annotations?.idempotentHint, true);
    }
    for (const name of ["start_record", "add_note", "control_record"]) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, false);
      assert.equal(byName.get(name)?.annotations?.idempotentHint, false);
    }
    assert.equal(byName.get("start_record")?.annotations?.destructiveHint, false);
    assert.equal(byName.get("add_note")?.annotations?.destructiveHint, false);
    assert.equal(byName.get("control_record")?.annotations?.destructiveHint, true);

    const status = await client.callTool({ name: "get_status", arguments: {} }) as CallToolResult;
    assert.equal(status.isError, undefined);
    assert.equal(structured(status).recordCount, 1);

    const records = await client.callTool({
      name: "list_records",
      arguments: { project: "echolog", type: "task", limit: 10 },
    }) as CallToolResult;
    assert.deepEqual(structured(records).records, [baseRecord]);

    const subtasks = await client.callTool({
      name: "get_subtasks",
      arguments: { id: "parent" },
    }) as CallToolResult;
    assert.deepEqual((structured(subtasks).progress as { total: number }).total, 1);

    const started = await client.callTool({
      name: "start_record",
      arguments: { title: "MCP smoke", project: "echolog", tags: ["mcp"] },
    }) as CallToolResult;
    assert.equal(structured(started).id, "record-1");

    const note = await client.callTool({
      name: "add_note",
      arguments: { id: "record-1", content: "blocked on review", type: "blocker" },
    }) as CallToolResult;
    assert.equal(structured(note).type, "blocker");

    const stopped = await client.callTool({
      name: "control_record",
      arguments: { id: "record-1", action: "stop", result: "verified" },
    }) as CallToolResult;
    assert.equal(structured(stopped).status, "done");

    const invalidControl = await client.callTool({
      name: "control_record",
      arguments: { id: "record-1", action: "pause", result: "invalid" },
    }) as CallToolResult;
    assert.equal(invalidControl.isError, true);
    assert.match(invalidControl.content[0]?.type === "text"
      ? invalidControl.content[0].text
      : "", /result is valid only when action is stop/);

    const ambiguous = await client.callTool({
      name: "control_record",
      arguments: { action: "stop" },
    }) as CallToolResult;
    assert.equal(toolError(ambiguous).status, 409);
    assert.deepEqual(toolError(ambiguous).candidates, [
      { id: "record-1", title: "MCP smoke", status: "running" },
      { id: "record-2", title: "Other work", status: "paused" },
    ]);

    const missing = await client.callTool({
      name: "get_subtasks",
      arguments: { id: "missing" },
    }) as CallToolResult;
    assert.equal(toolError(missing).status, 404);
    assert.equal(toolError(missing).error, "Record not found: missing");

    const report = await client.callTool({
      name: "generate_report",
      arguments: { date: "2026-08-03" },
    }) as CallToolResult;
    assert.equal(structured(report).markdown, "# 2026-08-03\n");

    const screen = await client.callTool({
      name: "get_screen_time",
      arguments: { date: "2026-08-03" },
    }) as CallToolResult;
    assert.deepEqual(toolError(screen), {
      error: "screen-time unavailable",
      code: "PLUGIN_DEGRADED",
      pluginId: "screen-time",
      state: "degraded",
      status: 503,
    });

    const startRequest = requests.find((request) =>
      request.method === "POST" && request.path === "/api/records"
    );
    assert.deepEqual(startRequest?.body, {
      title: "MCP smoke",
      type: "task",
      tags: ["mcp"],
      project: "echolog",
      source: "api",
    });
    assert.ok(requests.some((request) =>
      request.method === "GET" && request.path === "/api/records?project=echolog&type=task&limit=10"
    ));

    await new Promise<void>((resolve, reject) => httpServer.close((error) =>
      error ? reject(error) : resolve()
    ));
    httpClosed = true;

    const offline = await client.callTool({ name: "get_status", arguments: {} }) as CallToolResult;
    assert.equal(toolError(offline).code, "CONNECTION_ERROR");
    assert.match(String(toolError(offline).error), /无法连接到 EchoLog server/);
  } finally {
    await client.close().catch(() => undefined);
    if (!httpClosed) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});
