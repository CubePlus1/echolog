import { render } from "ejs";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getRecordsByDate, getRecordNotes, getTodaySummary } from "./recorder.js";
import type { Record, Note } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RecordWithNotes extends Record {
  notes: Note[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function percent(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

export async function generateDailyReport(date?: string): Promise<string> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const dayRecords = await getRecordsByDate(targetDate);

  const recordsWithNotes: RecordWithNotes[] = [];
  for (const r of dayRecords) {
    if (r.status === "cancelled") continue;
    const rNotes = await getRecordNotes(r.id);
    recordsWithNotes.push({ ...r, notes: rNotes });
  }

  const learning = recordsWithNotes.filter((r) => r.type === "learning");
  const project = recordsWithNotes.filter((r) => r.type === "project");
  const task = recordsWithNotes.filter((r) => r.type === "task");

  let totalSeconds = 0;
  const byType = { learning: 0, project: 0, task: 0 };
  for (const r of recordsWithNotes) {
    totalSeconds += r.durationSeconds;
    if (r.type in byType) {
      byType[r.type as keyof typeof byType] += r.durationSeconds;
    }
  }

  const blockers: string[] = [];
  const nextActions: string[] = [];
  for (const r of recordsWithNotes) {
    for (const n of r.notes) {
      if (n.type === "blocker") blockers.push(n.content);
      if (n.type === "next") nextActions.push(n.content);
    }
  }

  const templatePath = join(__dirname, "../../templates/daily.md.ejs");
  const template = readFileSync(templatePath, "utf-8");

  return render(template, {
    date: targetDate,
    records: recordsWithNotes,
    learning,
    project,
    task,
    totalSeconds,
    byType,
    blockers,
    nextActions,
    formatDuration,
    formatTime,
    percent,
    generatedAt: new Date().toISOString(),
  });
}
