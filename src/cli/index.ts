#!/usr/bin/env node
import { Command } from "commander";
import { api, post, patch, del } from "./api.js";

const program = new Command();
program.name("el").description("EchoLog - 开发者行为记录工具").version("0.1.0");

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

// cl start "title" -t tag1,tag2 --type learning -p project
program
  .command("start <title>")
  .description("开始一个新任务")
  .option("-t, --tags <tags>", "标签（逗号分隔）")
  .option("--type <type>", "类型: learning/project/task", "task")
  .option("-p, --project <project>", "项目名")
  .action(async (title, opts) => {
    const record = await post("/api/records", {
      title,
      type: opts.type,
      tags: opts.tags?.split(",").map((t: string) => t.trim()) ?? [],
      project: opts.project,
      source: "cli",
    });
    console.log(`✓ 已开始: ${record.title} [${record.id}]`);
  });

// cl stop [id] -n "result"
program
  .command("stop [id]")
  .description("停止任务")
  .option("-n, --note <result>", "结果总结")
  .option("--all", "停止所有任务")
  .action(async (id, opts) => {
    if (opts.all) {
      const records = await post("/api/records/stop-all");
      console.log(`✓ 已停止 ${records.length} 个任务`);
      return;
    }
    if (!id) {
      const active = await api("/api/records/active");
      if (active.length === 0) {
        console.log("没有运行中的任务");
        return;
      }
      if (active.length === 1) {
        id = active[0].id;
      } else {
        console.log("多个任务运行中，请指定 id:");
        for (const r of active) {
          console.log(`  ${r.id}  ${r.title}  (${r.status})`);
        }
        return;
      }
    }
    const record = await patch(`/api/records/${id}`, {
      action: "stop",
      result: opts.note,
    });
    console.log(`✓ 已停止: ${record.title} [${formatDuration(record.durationSeconds)}]`);
  });

// cl pause [id]
program
  .command("pause [id]")
  .description("暂停任务")
  .action(async (id) => {
    if (!id) {
      const active = await api("/api/records/active");
      const running = active.filter((r: any) => r.status === "running");
      if (running.length === 1) id = running[0].id;
      else {
        console.log("请指定任务 id");
        return;
      }
    }
    const record = await patch(`/api/records/${id}`, { action: "pause" });
    console.log(`⏸ 已暂停: ${record.title}`);
  });

// cl resume [id]
program
  .command("resume [id]")
  .description("恢复任务")
  .action(async (id) => {
    if (!id) {
      const active = await api("/api/records/active");
      const paused = active.filter((r: any) => r.status === "paused");
      if (paused.length === 1) id = paused[0].id;
      else {
        console.log("请指定任务 id");
        return;
      }
    }
    const record = await patch(`/api/records/${id}`, { action: "resume" });
    console.log(`▶ 已恢复: ${record.title}`);
  });

// cl status
program
  .command("status")
  .description("查看当前状态")
  .action(async () => {
    const summary = await api("/api/summary/today");
    const active = summary.active ?? [];

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
    console.log(`  总时间: ${formatDuration(summary.totalSeconds)}`);
    console.log(`  记录数: ${summary.recordCount}`);
    if (summary.byType.learning > 0) console.log(`  学习: ${formatDuration(summary.byType.learning)}`);
    if (summary.byType.project > 0) console.log(`  项目: ${formatDuration(summary.byType.project)}`);
    if (summary.byType.task > 0) console.log(`  任务: ${formatDuration(summary.byType.task)}`);
  });

// cl note [id] "content" -b -x
program
  .command("note [id] <content>")
  .description("追加笔记")
  .option("-b, --blocker", "标记为阻塞项")
  .option("-x, --next", "标记为后续行动")
  .action(async (id, content, opts) => {
    if (!content && id) {
      // cl note "content" without id
      const active = await api("/api/records/active");
      if (active.length === 1) {
        content = id;
        id = active[0].id;
      } else {
        console.log("多个任务运行中，请指定 id");
        return;
      }
    }
    const type = opts.blocker ? "blocker" : opts.next ? "next" : "note";
    await post(`/api/records/${id}/notes`, { content, type });
    const label = type === "blocker" ? "阻塞" : type === "next" ? "后续" : "笔记";
    console.log(`✓ 已添加${label}: ${content}`);
  });

// cl today
program
  .command("today")
  .description("今日摘要")
  .action(async () => {
    const today = localDateStr();
    const data = await api(`/api/summary/daily/${today}`);
    console.log(`📅 ${today}`);
    console.log(`  总时间: ${formatDuration(data.totalSeconds)} | 记录: ${data.recordCount}`);
    console.log();
    for (const r of data.records) {
      if (r.status === "cancelled") continue;
      const status = r.status === "running" ? "▶" : r.status === "paused" ? "⏸" : "✓";
      console.log(`  ${status} ${formatTime(r.startAt)} ${r.title} (${formatDuration(r.durationSeconds)}) [${r.type}]`);
    }
  });

// cl log
program
  .command("log")
  .description("查看历史记录")
  .option("--since <date>", "起始日期")
  .option("-p, --project <project>", "按项目过滤")
  .option("--type <type>", "按类型过滤")
  .option("-n, --limit <n>", "数量限制", "20")
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.since) params.set("since", opts.since);
    if (opts.project) params.set("project", opts.project);
    if (opts.type) params.set("type", opts.type);
    params.set("limit", opts.limit);
    const records = await api(`/api/records?${params}`);
    for (const r of records) {
      const date = r.startAt.slice(0, 10);
      const status = r.status === "done" ? "✓" : r.status === "running" ? "▶" : r.status === "paused" ? "⏸" : "✗";
      console.log(`  ${status} ${date} ${r.title} (${formatDuration(r.durationSeconds)}) [${r.type}] ${r.id}`);
    }
  });

// cl report
program
  .command("report")
  .description("生成日报")
  .option("--date <date>", "指定日期")
  .action(async (opts) => {
    const data = await post("/api/reports/daily", { date: opts.date });
    console.log(data.markdown);
  });

// cl sync
program
  .command("sync")
  .description("同步 Markdown 到目标目录")
  .option("--date <date>", "指定日期")
  .action(async (opts) => {
    const data = await post("/api/sync", { date: opts.date });
    console.log(`✓ 已同步: ${data.path}`);
  });

// cl add "title" --at "time" --for 90m
program
  .command("add <title>")
  .description("补记历史任务")
  .option("--at <time>", "开始时间")
  .option("--for <duration>", "持续时间 (如 90m, 2h)")
  .option("-t, --tags <tags>", "标签")
  .option("--type <type>", "类型", "task")
  .option("-p, --project <project>", "项目")
  .option("-n, --note <result>", "结果")
  .action(async (title, opts) => {
    if (!opts.at || !opts.for) {
      console.error("补记需要 --at 和 --for 参数");
      return;
    }
    const startAt = new Date(opts.at);
    if (isNaN(startAt.getTime())) {
      console.error(`无法解析时间: ${opts.at}`);
      return;
    }
    const match = opts.for.match(/^(\d+)(m|h)$/);
    if (!match) {
      console.error("时长格式: 90m 或 2h");
      return;
    }
    const minutes = match[2] === "h" ? parseInt(match[1]) * 60 : parseInt(match[1]);

    const record = await post("/api/records/backfill", {
      title,
      type: opts.type,
      tags: opts.tags?.split(",").map((t: string) => t.trim()) ?? [],
      project: opts.project,
      startAt: startAt.toISOString(),
      durationMinutes: minutes,
      result: opts.note,
    });
    console.log(`✓ 已补记: ${record.title} [${formatDuration(record.durationSeconds)}]`);
  });

// cl edit <id>
program
  .command("edit <id>")
  .description("编辑记录")
  .option("-n, --note <result>", "更新结果")
  .option("--title <title>", "更新标题")
  .option("--type <type>", "更新类型")
  .option("-t, --tags <tags>", "更新标签")
  .option("-p, --project <project>", "更新项目")
  .action(async (id, opts) => {
    const updates: any = { action: "edit" };
    if (opts.note) updates.result = opts.note;
    if (opts.title) updates.title = opts.title;
    if (opts.type) updates.type = opts.type;
    if (opts.tags) updates.tags = opts.tags.split(",").map((t: string) => t.trim());
    if (opts.project) updates.project = opts.project;
    const record = await patch(`/api/records/${id}`, updates);
    console.log(`✓ 已更新: ${record.title}`);
  });

// cl cancel [id]
program
  .command("cancel [id]")
  .description("取消任务")
  .action(async (id) => {
    if (!id) {
      const active = await api("/api/records/active");
      if (active.length === 1) id = active[0].id;
      else {
        console.log("请指定任务 id");
        return;
      }
    }
    const record = await del(`/api/records/${id}`);
    console.log(`✗ 已取消: ${record.title}`);
  });

// el daemon start|stop|status|install
const daemon = program.command("daemon").description("管理后台服务");

daemon.command("start").action(async () => {
  const { execSync } = await import("child_process");
  try {
    await api("/api/health");
    console.log("服务已在运行中");
  } catch {
    execSync("nohup tsx src/server/app.ts > /tmp/echolog.log 2>&1 &", {
      cwd: process.cwd(),
      stdio: "ignore",
    });
    console.log("✓ EchoLog daemon 已启动");
  }
});

daemon.command("stop").action(async () => {
  const { execSync } = await import("child_process");
  try {
    execSync("pkill -f 'tsx src/server/app.ts'", { stdio: "ignore" });
    console.log("✓ EchoLog daemon 已停止");
  } catch {
    console.log("daemon 未在运行");
  }
});

daemon.command("status").action(async () => {
  try {
    const data = await api("/api/health");
    console.log(`✓ 运行中 (${data.timestamp})`);
  } catch {
    console.log("✗ 未运行");
  }
});

program.parse();
