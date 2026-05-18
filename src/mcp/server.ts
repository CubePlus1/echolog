import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  startRecord,
  stopRecord,
  pauseRecord,
  resumeRecord,
  addNote,
  getActiveRecords,
  getRecords,
  getTodaySummary,
} from "../core/recorder.js";
import { generateDailyReport } from "../core/reporter.js";
import { syncDaily } from "../core/syncer.js";

const server = new Server(
  { name: "clawlog", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_record",
      description:
        "开始一个新的记录任务。支持同时运行多个任务。",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "任务标题" },
          type: {
            type: "string",
            enum: ["learning", "project", "task"],
            description: "类型：learning/project/task",
            default: "task",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表",
          },
          project: { type: "string", description: "项目名" },
        },
        required: ["title"],
      },
    },
    {
      name: "stop_record",
      description: "停止一个正在运行的任务。如果只有一个活跃任务，可省略 id。",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "记录 ID（可选，单任务时自动匹配）" },
          result: { type: "string", description: "结果总结" },
        },
      },
    },
    {
      name: "pause_record",
      description: "暂停一个正在运行的任务",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "记录 ID" },
        },
      },
    },
    {
      name: "resume_record",
      description: "恢复一个暂停的任务",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "记录 ID" },
        },
      },
    },
    {
      name: "add_note",
      description: "给任务追加笔记、阻塞项或后续行动",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "记录 ID" },
          content: { type: "string", description: "笔记内容" },
          noteType: {
            type: "string",
            enum: ["note", "blocker", "next"],
            description: "类型",
            default: "note",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "get_status",
      description: "获取当前所有活跃任务和今日概览",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_records",
      description: "查询历史记录",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: { type: "string", description: "日期 YYYY-MM-DD" },
          project: { type: "string", description: "项目名" },
          type: { type: "string", description: "类型" },
        },
      },
    },
    {
      name: "generate_report",
      description: "生成日报 Markdown",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: { type: "string", description: "日期 YYYY-MM-DD（默认今天）" },
        },
      },
    },
    {
      name: "sync_markdown",
      description: "同步日报 Markdown 到 Eoove-demo/docs",
      inputSchema: {
        type: "object" as const,
        properties: {
          date: { type: "string", description: "日期 YYYY-MM-DD" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "start_record": {
        const record = await startRecord({
          title: (args as any).title,
          type: (args as any).type,
          tags: (args as any).tags,
          project: (args as any).project,
          source: "mcp",
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(record, null, 2),
            },
          ],
        };
      }

      case "stop_record": {
        let id = (args as any).id;
        if (!id) {
          const active = await getActiveRecords();
          const running = active.filter((r) => r.status === "running");
          if (running.length === 1) id = running[0].id;
          else
            return {
              content: [
                {
                  type: "text",
                  text: `有 ${running.length} 个运行中的任务，请指定 id: ${running.map((r) => `${r.id} (${r.title})`).join(", ")}`,
                },
              ],
            };
        }
        const record = await stopRecord({ id, result: (args as any).result });
        return {
          content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
        };
      }

      case "pause_record": {
        let id = (args as any).id;
        if (!id) {
          const active = await getActiveRecords();
          const running = active.filter((r) => r.status === "running");
          if (running.length === 1) id = running[0].id;
          else
            return {
              content: [
                {
                  type: "text",
                  text: `有 ${running.length} 个运行中的任务，请指定 id: ${running.map((r) => `${r.id} (${r.title})`).join(", ")}`,
                },
              ],
            };
        }
        const record = await pauseRecord(id);
        return {
          content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
        };
      }

      case "resume_record": {
        let id = (args as any).id;
        if (!id) {
          const active = await getActiveRecords();
          const paused = active.filter((r) => r.status === "paused");
          if (paused.length === 1) id = paused[0].id;
          else
            return {
              content: [
                {
                  type: "text",
                  text: `有 ${paused.length} 个暂停的任务，请指定 id: ${paused.map((r) => `${r.id} (${r.title})`).join(", ")}`,
                },
              ],
            };
        }
        const record = await resumeRecord(id);
        return {
          content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
        };
      }

      case "add_note": {
        let id = (args as any).id;
        if (!id) {
          const active = await getActiveRecords();
          if (active.length === 1) id = active[0].id;
          else
            return {
              content: [
                { type: "text", text: "多个活跃任务，请指定 id" },
              ],
            };
        }
        const note = await addNote({
          recordId: id,
          content: (args as any).content,
          type: (args as any).noteType,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(note, null, 2) }],
        };
      }

      case "get_status": {
        const summary = await getTodaySummary();
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      }

      case "get_records": {
        const records = await getRecords({
          date: (args as any).date,
          project: (args as any).project,
          type: (args as any).type,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(records, null, 2) }],
        };
      }

      case "generate_report": {
        const markdown = await generateDailyReport((args as any).date);
        return { content: [{ type: "text", text: markdown }] };
      }

      case "sync_markdown": {
        const path = await syncDaily((args as any).date);
        return {
          content: [{ type: "text", text: `已同步到: ${path}` }],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
