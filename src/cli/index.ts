import { execSync } from "child_process";
import { Command } from "commander";
import { ApiError, ConnectionError, api, post, patch, del } from "./api.js";

const wantsJsonOutput = process.argv.includes("--json");

const program = new Command();
program
  .name("el")
  .description(
    [
      "EchoLog CLI - 面向开发者与智能体的本地行为记录工具。",
      "",
      "智能体使用建议：优先加 --json 获取原始 API JSON；成功退出码为 0，API 错误、校验失败、连接失败或省略 id 后出现歧义时退出码非 0；省略 id 的 stop/pause/resume/cancel/note 会交给服务端匹配唯一活跃记录。",
    ].join("\n")
  )
  .version("0.1.0")
  .option("--json", "输出机器可读 JSON；成功时透传 API 原始响应，错误时输出 JSON 错误体")
  .addHelpText(
    "after",
    `
示例:
  $ el start "写接口文档" --type project -t docs,api
  $ el status --json
  $ el note "卡在认证逻辑" --blocker
  $ el stop --json
`
  );

program.configureOutput({
  outputError: (str, write) => {
    if (wantsJsonOutput) {
      const message = str.replace(/^error:\s*/i, "").trim();
      write(`${JSON.stringify({ error: message })}\n`);
      return;
    }
    write(str);
  },
});

type RecordType = "learning" | "project" | "task";
type NoteType = "note" | "blocker" | "next";

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function jsonMode(command?: Command): boolean {
  return Boolean(command?.optsWithGlobals?.().json ?? program.opts().json);
}

function withJson(command: Command): Command {
  return command.option("--json", "输出机器可读 JSON；成功时透传 API 原始响应");
}

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseType(type: string): RecordType {
  if (type === "learning" || type === "project" || type === "task") {
    return type;
  }
  throw new CliUsageError("type 只能是 learning、project 或 task");
}

function parseNoteType(opts: { blocker?: boolean; next?: boolean }): NoteType {
  if (opts.blocker && opts.next) {
    throw new CliUsageError("--blocker 和 --next 不能同时使用");
  }
  return opts.blocker ? "blocker" : opts.next ? "next" : "note";
}

function splitCsv(value?: string): string[] {
  return value?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
}

function printCandidates(body: unknown): void {
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return;
  console.error("候选记录:");
  for (const c of candidates as Array<{ id?: string; title?: string; status?: string }>) {
    console.error(`  ${c.id ?? ""}\t${c.title ?? ""}\t${c.status ?? ""}`);
  }
}

function printError(error: unknown, asJson: boolean): void {
  if (asJson) {
    if (error instanceof ApiError && typeof error.body === "object" && error.body !== null) {
      console.error(JSON.stringify(error.body, null, 2));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ error: message }));
    return;
  }

  if (error instanceof ApiError) {
    console.error(error.message);
    if (error.status === 409) printCandidates(error.body);
    return;
  }
  if (error instanceof ConnectionError || error instanceof CliUsageError || error instanceof Error) {
    console.error(error.message);
    return;
  }
  console.error(String(error));
}

function action<T extends unknown[]>(
  fn: (thisCommand: Command, ...args: T) => Promise<void>
): (...args: [...T, Command]) => Promise<void> {
  return async (...args: [...T, Command]) => {
    const thisCommand = args[args.length - 1] as Command;
    try {
      await fn(thisCommand, ...(args.slice(0, -1) as T));
    } catch (error) {
      printError(error, jsonMode(thisCommand));
      process.exitCode = 1;
    }
  };
}

function printSuccess(thisCommand: Command, data: unknown, human: () => void): void {
  if (jsonMode(thisCommand)) {
    outputJson(data);
    return;
  }
  human();
}

function formatMinute(minute: number | null | undefined): string | undefined {
  if (minute == null) return undefined;
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// el start "title" -t tag1,tag2 --type learning -p project
withJson(
  program
    .command("start <title>")
    .description("开始一条新记录；title 为记录标题，type 只能是 learning、project、task，默认 task。")
    .option("-t, --tags <tags>", "标签，逗号分隔，如 docs,api")
    .option("--type <type>", "记录类型: learning | project | task", "task")
    .option("-p, --project <project>", "所属项目名")
    .addHelpText(
      "after",
      `
示例:
  $ el start "读论文" --type learning -t paper,ai
  $ el start "实现 CLI JSON 输出" --type project -p echolog --json
`
    )
).action(
  action(async (thisCommand, title: string, opts: { tags?: string; type: string; project?: string }) => {
    const record = await post("/api/records", {
      title,
      type: parseType(opts.type),
      tags: splitCsv(opts.tags),
      project: opts.project,
      source: "cli",
    });
    printSuccess(thisCommand, record, () => {
      console.log(`✓ 已开始: ${(record as any).title} [${(record as any).id}]`);
    });
  })
);

// el stop [id] -n "result"
withJson(
  program
    .command("stop [id]")
    .description("停止记录；省略 id 时由服务端匹配唯一 running 记录，多条候选返回 409。")
    .option("-n, --note <result>", "结果总结，写入 record.result")
    .option("--all", "停止所有 running 记录")
    .addHelpText(
      "after",
      `
示例:
  $ el stop
  $ el stop <id> -n "完成接口联调"
  $ el stop --all --json
`
    )
).action(
  action(async (thisCommand, id: string | undefined, opts: { note?: string; all?: boolean }) => {
    if (opts.all) {
      const records = await post("/api/records/stop-all");
      printSuccess(thisCommand, records, () => {
        console.log(`✓ 已停止 ${(records as any[]).length} 个任务`);
      });
      return;
    }
    const record = await patch(id ? `/api/records/${id}` : "/api/records/active", {
      action: "stop",
      result: opts.note,
    });
    printSuccess(thisCommand, record, () => {
      console.log(`✓ 已停止: ${(record as any).title} [${formatDuration((record as any).durationSeconds)}]`);
    });
  })
);

// el pause [id]
withJson(
  program
    .command("pause [id]")
    .description("暂停记录；省略 id 时由服务端匹配唯一 running 记录，多条候选返回 409。")
    .addHelpText(
      "after",
      `
示例:
  $ el pause
  $ el pause <id> --json
`
    )
).action(
  action(async (thisCommand, id?: string) => {
    const record = await patch(id ? `/api/records/${id}` : "/api/records/active", { action: "pause" });
    printSuccess(thisCommand, record, () => {
      console.log(`⏸ 已暂停: ${(record as any).title}`);
    });
  })
);

// el resume [id]
withJson(
  program
    .command("resume [id]")
    .description("恢复记录；省略 id 时由服务端匹配唯一 paused 记录，多条候选返回 409。")
    .addHelpText(
      "after",
      `
示例:
  $ el resume
  $ el resume <id> --json
`
    )
).action(
  action(async (thisCommand, id?: string) => {
    const record = await patch(id ? `/api/records/${id}` : "/api/records/active", { action: "resume" });
    printSuccess(thisCommand, record, () => {
      console.log(`▶ 已恢复: ${(record as any).title}`);
    });
  })
);

// el status
withJson(
  program
    .command("status")
    .description("查看今日汇总与活跃记录；JSON 模式透传 /api/summary/today。")
    .addHelpText(
      "after",
      `
示例:
  $ el status
  $ el status --json
`
    )
).action(
  action(async (thisCommand) => {
    const summary = await api("/api/summary/today");
    printSuccess(thisCommand, summary, () => {
      const active = (summary as any).active ?? [];

      if (active.length > 0) {
        console.log("运行中的任务:");
        for (const r of active) {
          const elapsed = Math.round((Date.now() - new Date(r.startAt).getTime()) / 1000);
          const icon = r.status === "paused" ? "⏸" : "▶";
          console.log(`  ${icon} ${r.title} [${r.id}] ${formatDuration(elapsed)} (${r.status})`);
        }
        console.log();
      } else {
        console.log("没有进行中的任务\n");
      }

      console.log(`今日概览:`);
      console.log(`  总时间: ${formatDuration((summary as any).totalSeconds)}`);
      console.log(`  记录数: ${(summary as any).recordCount}`);
      if ((summary as any).byType.learning > 0) console.log(`  学习: ${formatDuration((summary as any).byType.learning)}`);
      if ((summary as any).byType.project > 0) console.log(`  项目: ${formatDuration((summary as any).byType.project)}`);
      if ((summary as any).byType.task > 0) console.log(`  任务: ${formatDuration((summary as any).byType.task)}`);
    });
  })
);

// el note "content" -r <id> -b -x
withJson(
  program
    .command("note <content>")
    .description("追加笔记；content 为笔记正文，-r/--record 指定记录 id，省略则写入唯一活跃记录。")
    .option("-r, --record <id>", "记录 id；省略时调用 /api/records/active/notes")
    .option("-b, --blocker", "笔记类型为 blocker（阻塞项）")
    .option("-x, --next", "笔记类型为 next（后续行动）；默认类型为 note")
    .addHelpText(
      "after",
      `
示例:
  $ el note "卡在第三章" --blocker
  $ el note "明天继续写测试" --next -r <id>
  $ el note "记录给唯一活跃任务" --json
`
    )
).action(
  action(
    async (
      thisCommand,
      content: string,
      opts: { record?: string; blocker?: boolean; next?: boolean }
    ) => {
      const type = parseNoteType(opts);
      const path = opts.record ? `/api/records/${opts.record}/notes` : "/api/records/active/notes";
      const note = await post(path, { content, type });
      printSuccess(thisCommand, note, () => {
        const label = type === "blocker" ? "阻塞" : type === "next" ? "后续" : "笔记";
        console.log(`✓ 已添加${label}: ${content}`);
      });
    }
  )
);

// el today
withJson(
  program
    .command("today")
    .description("查看某日本地日期汇总；--date 为 YYYY-MM-DD，省略时使用今天。")
    .option("--date <date>", "本地日期，格式 YYYY-MM-DD")
    .addHelpText(
      "after",
      `
示例:
  $ el today
  $ el today --date 2026-07-08 --json
`
    )
).action(
  action(async (thisCommand, opts: { date?: string }) => {
    const date = opts.date ?? localDateStr();
    const data = await api(`/api/summary/daily/${date}`);
    printSuccess(thisCommand, data, () => {
      console.log(`📅 ${date}`);
      console.log(`  总时间: ${formatDuration((data as any).totalSeconds)} | 记录: ${(data as any).recordCount}`);
      console.log();
      for (const r of (data as any).records) {
        if (r.status === "cancelled") continue;
        const status = r.status === "running" ? "▶" : r.status === "paused" ? "⏸" : "✓";
        console.log(`  ${status} ${formatTime(r.startAt)} ${r.title} (${formatDuration(r.durationSeconds)}) [${r.type}]`);
      }
    });
  })
);

// el log
withJson(
  program
    .command("log")
    .description("查看历史记录；since 为 ISO 时间或日期，type 只能是 learning、project、task。")
    .option("--since <date>", "起始时间，如 2026-07-01 或 2026-07-01T00:00:00+08:00")
    .option("-p, --project <project>", "按项目过滤")
    .option("--type <type>", "按类型过滤: learning | project | task")
    .option("-n, --limit <n>", "数量限制", "20")
    .addHelpText(
      "after",
      `
示例:
  $ el log --since 2026-07-01 --type project
  $ el log -p echolog -n 50 --json
`
    )
).action(
  action(async (thisCommand, opts: { since?: string; project?: string; type?: string; limit: string }) => {
    const params = new URLSearchParams();
    if (opts.since) params.set("since", opts.since);
    if (opts.project) params.set("project", opts.project);
    if (opts.type) params.set("type", parseType(opts.type));
    params.set("limit", opts.limit);
    const records = await api(`/api/records?${params}`);
    printSuccess(thisCommand, records, () => {
      for (const r of records as any[]) {
        const date = r.startAt.slice(0, 10);
        const status = r.status === "done" ? "✓" : r.status === "running" ? "▶" : r.status === "paused" ? "⏸" : "✗";
        console.log(`  ${status} ${date} ${r.title} (${formatDuration(r.durationSeconds)}) [${r.type}] ${r.id}`);
      }
    });
  })
);

// el report
withJson(
  program
    .command("report")
    .description("生成日报 Markdown；date 为 YYYY-MM-DD，省略时由服务端使用今天。")
    .option("--date <date>", "本地日期，格式 YYYY-MM-DD")
    .addHelpText(
      "after",
      `
示例:
  $ el report --date 2026-07-08
  $ el report --json
`
    )
).action(
  action(async (thisCommand, opts: { date?: string }) => {
    const data = await post("/api/reports/daily", { date: opts.date });
    printSuccess(thisCommand, data, () => {
      console.log((data as any).markdown);
    });
  })
);

// el sync
withJson(
  program
    .command("sync")
    .description("同步日报 Markdown 到配置的目标目录；date 为 YYYY-MM-DD，省略时同步今天。")
    .option("--date <date>", "本地日期，格式 YYYY-MM-DD")
    .addHelpText(
      "after",
      `
示例:
  $ el sync
  $ el sync --date 2026-07-08 --json
`
    )
).action(
  action(async (thisCommand, opts: { date?: string }) => {
    const data = await post("/api/sync", { date: opts.date });
    printSuccess(thisCommand, data, () => {
      console.log(`✓ 已同步: ${(data as any).path}`);
    });
  })
);

// el add "title" --at "time" --for 90m
withJson(
  program
    .command("add <title>")
    .description("补记历史记录；--at 为可被 Date 解析的开始时间，--for 为 90m 或 2h，type 默认 task。")
    .option("--at <time>", "开始时间，如 2026-07-08T09:30:00+08:00")
    .option("--for <duration>", "持续时间，如 90m 或 2h")
    .option("-t, --tags <tags>", "标签，逗号分隔")
    .option("--type <type>", "记录类型: learning | project | task", "task")
    .option("-p, --project <project>", "所属项目")
    .option("-n, --note <result>", "结果总结")
    .addHelpText(
      "after",
      `
示例:
  $ el add "晨会" --at "2026-07-08T09:30:00+08:00" --for 30m
  $ el add "补写报告" --at "2026-07-08 14:00" --for 2h --type project --json
`
    )
).action(
  action(
    async (
      thisCommand,
      title: string,
      opts: { at?: string; for?: string; tags?: string; type: string; project?: string; note?: string }
    ) => {
      if (!opts.at || !opts.for) {
        throw new CliUsageError("补记需要 --at 和 --for 参数");
      }
      const startAt = new Date(opts.at);
      if (isNaN(startAt.getTime())) {
        throw new CliUsageError(`无法解析时间: ${opts.at}`);
      }
      const match = opts.for.match(/^(\d+)(m|h)$/);
      if (!match) {
        throw new CliUsageError("时长格式: 90m 或 2h");
      }
      const minutes = match[2] === "h" ? parseInt(match[1], 10) * 60 : parseInt(match[1], 10);

      const record = await post("/api/records/backfill", {
        title,
        type: parseType(opts.type),
        tags: splitCsv(opts.tags),
        project: opts.project,
        startAt: startAt.toISOString(),
        durationMinutes: minutes,
        result: opts.note,
      });
      printSuccess(thisCommand, record, () => {
        console.log(`✓ 已补记: ${(record as any).title} [${formatDuration((record as any).durationSeconds)}]`);
      });
    }
  )
);

// el edit <id>
withJson(
  program
    .command("edit <id>")
    .description("编辑记录；id 必填，type 只能是 learning、project、task。")
    .option("-n, --note <result>", "更新结果总结")
    .option("--title <title>", "更新标题")
    .option("--type <type>", "更新类型: learning | project | task")
    .option("-t, --tags <tags>", "更新标签，逗号分隔")
    .option("-p, --project <project>", "更新项目")
    .addHelpText(
      "after",
      `
示例:
  $ el edit <id> --title "新标题"
  $ el edit <id> --type learning -t reading,history --json
`
    )
).action(
  action(async (thisCommand, id: string, opts: { note?: string; title?: string; type?: string; tags?: string; project?: string }) => {
    const updates: any = { action: "edit" };
    if (opts.note) updates.result = opts.note;
    if (opts.title) updates.title = opts.title;
    if (opts.type) updates.type = parseType(opts.type);
    if (opts.tags) updates.tags = splitCsv(opts.tags);
    if (opts.project) updates.project = opts.project;
    const record = await patch(`/api/records/${id}`, updates);
    printSuccess(thisCommand, record, () => {
      console.log(`✓ 已更新: ${(record as any).title}`);
    });
  })
);

// el cancel [id]
withJson(
  program
    .command("cancel [id]")
    .description("作废记录；省略 id 时由服务端匹配唯一活跃记录，多条候选返回 409。")
    .addHelpText(
      "after",
      `
示例:
  $ el cancel
  $ el cancel <id> --json
`
    )
).action(
  action(async (thisCommand, id?: string) => {
    const record = await del(id ? `/api/records/${id}` : "/api/records/active");
    printSuccess(thisCommand, record, () => {
      console.log(`✗ 已取消: ${(record as any).title}`);
    });
  })
);

// el notes <id>
withJson(
  program
    .command("notes <id>")
    .description("读取指定记录的笔记；id 为记录 id，JSON 模式透传 /api/records/:id/notes。")
    .addHelpText(
      "after",
      `
示例:
  $ el notes <id>
  $ el notes <id> --json
`
    )
).action(
  action(async (thisCommand, id: string) => {
    const notes = await api(`/api/records/${id}/notes`);
    printSuccess(thisCommand, notes, () => {
      for (const note of notes as any[]) {
        const type = note.type === "blocker" ? "阻塞" : note.type === "next" ? "后续" : "笔记";
        console.log(`  ${formatTime(note.createdAt)} [${type}] ${note.content}`);
      }
    });
  })
);

// el screen [date]
const screen = program
  .command("screen")
  .description("查看屏幕使用或管理分类规则；date 为 YYYY-MM-DD，省略时查询今天。")
  .argument("[date]", "本地日期，格式 YYYY-MM-DD；省略时查询今天")
  .option("--json", "输出机器可读 JSON；成功时透传 API 原始响应")
  .addHelpText(
    "after",
    `
示例:
  $ el screen
  $ el screen 2026-07-08 --json
  $ el screen rules add 微信 生活 --priority 1
`
  )
  .action(
    action(async (thisCommand, date?: string) => {
      const data = await api(date ? `/api/screen/daily/${date}` : "/api/screen/today");
      printSuccess(thisCommand, data, () => {
        console.log(`📱 屏幕使用 ${(data as any).date}`);
        console.log(`  总时间: ${formatDuration((data as any).totalSeconds)}`);
        if ((data as any).byLabel.length > 0) {
          console.log("  分类:");
          for (const item of (data as any).byLabel) {
            console.log(`    ${item.label}: ${formatDuration(item.seconds)}`);
          }
        }
        if ((data as any).apps.length > 0) {
          console.log("  应用:");
          for (const item of (data as any).apps.slice(0, 10)) {
            console.log(`    ${item.appName}: ${formatDuration(item.seconds)} [${item.bundleId}]`);
          }
        }
      });
    })
  );

const screenRules = screen.command("rules").description("管理屏幕使用分类规则。");

withJson(
  screenRules
    .command("list")
    .description("列出屏幕分类规则；规则按 priority 降序返回。")
    .addHelpText(
      "after",
      `
示例:
  $ el screen rules list
  $ el screen rules list --json
`
    )
).action(
  action(async (thisCommand) => {
    const rules = await api("/api/screen/rules");
    printSuccess(thisCommand, rules, () => {
      for (const rule of rules as any[]) {
        const start = formatMinute(rule.startMinute);
        const end = formatMinute(rule.endMinute);
        const window = start && end ? `${start}-${end}` : "全天";
        const weekdays = rule.weekdays?.length ? ` weekdays=${rule.weekdays.join(",")}` : "";
        console.log(`  ${rule.id}\t${rule.appMatch} => ${rule.label}\t${window}\tpriority=${rule.priority}${weekdays}`);
      }
    });
  })
);

withJson(
  screenRules
    .command("add <appMatch> <label>")
    .description("新增屏幕分类规则；appMatch 为应用名或 bundle id 子串，label 为分类名。")
    .option("--start <HH:mm>", "本地开始时间，格式 HH:mm；必须与 --end 成对出现")
    .option("--end <HH:mm>", "本地结束时间，格式 HH:mm；start > end 表示跨夜")
    .option("--weekdays <days>", "适用星期，逗号分隔整数，0=周日，如 1,2,3,4,5")
    .option("--priority <n>", "优先级整数，越大越优先", "0")
    .addHelpText(
      "after",
      `
示例:
  $ el screen rules add 微信 生活
  $ el screen rules add 微信 工作 --start 09:00 --end 18:00 --weekdays 1,2,3,4,5 --priority 10 --json
`
    )
).action(
  action(
    async (
      thisCommand,
      appMatch: string,
      label: string,
      opts: { start?: string; end?: string; weekdays?: string; priority: string }
    ) => {
      const priority = Number.parseInt(opts.priority, 10);
      if (!Number.isInteger(priority)) {
        throw new CliUsageError("--priority 必须是整数");
      }
      const body: Record<string, unknown> = { appMatch, label, priority };
      if (opts.start || opts.end) {
        if (!opts.start || !opts.end) {
          throw new CliUsageError("--start 和 --end 必须成对出现");
        }
        body.startTime = opts.start;
        body.endTime = opts.end;
      }
      if (opts.weekdays) {
        const weekdays = opts.weekdays.split(",").map((d) => Number.parseInt(d.trim(), 10));
        if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
          throw new CliUsageError("--weekdays 只能包含 0 到 6 的整数，0=周日");
        }
        body.weekdays = weekdays;
      }

      const rule = await post("/api/screen/rules", body);
      printSuccess(thisCommand, rule, () => {
        console.log(`✓ 已添加规则: ${(rule as any).appMatch} => ${(rule as any).label} [${(rule as any).id}]`);
      });
    }
  )
);

withJson(
  screenRules
    .command("rm <id>")
    .alias("remove")
    .description("删除屏幕分类规则；id 为 el screen rules list 返回的规则 id。")
    .addHelpText(
      "after",
      `
示例:
  $ el screen rules rm <id>
  $ el screen rules rm <id> --json
`
    )
).action(
  action(async (thisCommand, id: string) => {
    const rule = await del(`/api/screen/rules/${id}`);
    printSuccess(thisCommand, rule, () => {
      console.log(`✓ 已删除规则: ${(rule as any).appMatch} => ${(rule as any).label}`);
    });
  })
);

// el daemon start|stop|status
const daemon = program
  .command("daemon")
  .description("管理后台服务；daemon 命令主要给本机使用，JSON 输出为 CLI 定义的状态对象。")
  .addHelpText(
    "after",
    `
示例:
  $ el daemon start
  $ el daemon status --json
  $ el daemon stop
`
  );

withJson(daemon.command("start").description("启动后台服务；若已运行则直接返回。")).action(
  action(async (thisCommand) => {
    try {
      const data = await api("/api/health");
      printSuccess(thisCommand, data, () => {
        console.log("服务已在运行中");
      });
      return;
    } catch {
      execSync("nohup tsx src/server/app.ts > /tmp/echolog.log 2>&1 &", {
        cwd: process.cwd(),
        stdio: "ignore",
      });
      const data = { status: "started" };
      printSuccess(thisCommand, data, () => {
        console.log("✓ EchoLog daemon 已启动");
      });
    }
  })
);

withJson(daemon.command("stop").description("停止后台服务。")).action(
  action(async (thisCommand) => {
    try {
      execSync("pkill -f 'tsx src/server/app.ts'", { stdio: "ignore" });
      printSuccess(thisCommand, { stopped: true }, () => {
        console.log("✓ EchoLog daemon 已停止");
      });
    } catch {
      printSuccess(thisCommand, { stopped: false }, () => {
        console.log("daemon 未在运行");
      });
    }
  })
);

withJson(daemon.command("status").description("查看后台服务健康状态；连接失败时退出码非 0。")).action(
  action(async (thisCommand) => {
    const data = await api("/api/health");
    printSuccess(thisCommand, data, () => {
      console.log(`✓ 运行中 (${(data as any).timestamp})`);
    });
  })
);

program.parseAsync().catch((error) => {
  printError(error, wantsJsonOutput);
  process.exitCode = 1;
});
