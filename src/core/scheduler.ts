import { getActiveRecords } from "./recorder.js";
import { notify } from "./notifier.js";
import { loadConfig } from "./config.js";

let intervalId: ReturnType<typeof setInterval> | null = null;
const notifiedOvertime = new Map<string, number>();
let lastIdleNotify = 0;
let lastReportNotify = 0;
let lastEodNotify = 0;

const COOLDOWN_MS = 30 * 60_000; // 30 minutes between repeated notifications

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

async function checkReminders() {
  const config = loadConfig();
  const rules = config.notifications.rules;
  const now = nowMinutes();
  const nowMs = Date.now();
  const active = await getActiveRecords();
  const running = active.filter((r) => r.status === "running");

  for (const r of running) {
    const elapsed = (Date.now() - r.startAt.getTime()) / 60_000;
    if (elapsed >= rules.task_overtime_minutes) {
      const lastNotified = notifiedOvertime.get(r.id) ?? 0;
      if (nowMs - lastNotified > COOLDOWN_MS) {
        notify(
          "任务超时",
          `「${r.title}」已运行 ${Math.round(elapsed)} 分钟`
        );
        notifiedOvertime.set(r.id, nowMs);
      }
    }
  }

  // Clean up entries for records no longer active
  for (const id of notifiedOvertime.keys()) {
    if (!active.find((r) => r.id === id)) {
      notifiedOvertime.delete(id);
    }
  }

  if (rules.idle_reminder_enabled) {
    const start = timeToMinutes(rules.idle_check_start);
    const end = timeToMinutes(rules.idle_check_end);
    if (
      now >= start &&
      now <= end &&
      running.length === 0 &&
      nowMs - lastIdleNotify > COOLDOWN_MS
    ) {
      notify("空闲提醒", "工作时间段没有进行中的任务，是否忘记开始了？");
      lastIdleNotify = nowMs;
    }
  }

  const reportTime = timeToMinutes(rules.daily_report_time);
  if (
    now >= reportTime &&
    now <= reportTime + 5 &&
    nowMs - lastReportNotify > COOLDOWN_MS
  ) {
    notify("日报提醒", "今天的任务已结束了吗？记得生成日报！");
    lastReportNotify = nowMs;
  }

  const eodTime = timeToMinutes(rules.end_of_day_time);
  if (
    now >= eodTime &&
    now <= eodTime + 5 &&
    running.length > 0 &&
    nowMs - lastEodNotify > COOLDOWN_MS
  ) {
    const titles = running.map((r) => r.title).join(", ");
    notify("忘记停止", `这些任务还在运行：${titles}`);
    lastEodNotify = nowMs;
  }
}

export function startScheduler() {
  if (intervalId) return;
  intervalId = setInterval(checkReminders, 60_000);
  checkReminders();
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
