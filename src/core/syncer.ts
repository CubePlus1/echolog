import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { loadConfig } from "./config.js";
import { generateDailyReport } from "./reporter.js";
import { localDateStr } from "./utils.js";

export async function syncDaily(date?: string): Promise<string> {
  const targetDate = date ?? localDateStr();
  const config = loadConfig();
  const targetDir = join(config.sync.target, "daily");

  await mkdir(targetDir, { recursive: true });

  const markdown = await generateDailyReport(targetDate);
  const filePath = join(targetDir, `${targetDate}.md`);
  await writeFile(filePath, markdown, "utf-8");
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
    const dateStr = localDateStr(d);
    const path = await syncDaily(dateStr);
    paths.push(path);
  }
  return paths;
}
