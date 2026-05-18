import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadConfig } from "./config.js";
import { generateDailyReport } from "./reporter.js";

export async function syncDaily(date?: string): Promise<string> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const config = loadConfig();
  const targetDir = join(config.sync.target, "daily");

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const markdown = await generateDailyReport(targetDate);
  const filePath = join(targetDir, `${targetDate}.md`);
  writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}

export async function syncDateRange(
  startDate: string,
  endDate: string
): Promise<string[]> {
  const paths: string[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const path = await syncDaily(dateStr);
    paths.push(path);
  }
  return paths;
}
