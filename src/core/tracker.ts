import { exec } from "child_process";
import { promisify } from "util";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { appUsage } from "./schema.js";
import { loadConfig } from "./config.js";

const execAsync = promisify(exec);

/**
 * 屏幕前台应用采样器（仅 macOS）
 * - 每 sample_seconds 秒取一次前台应用（lsappinfo，无需 TCC 权限）与空闲时长（ioreg HIDIdleTime）
 * - 同应用连续采样合并为一个「使用片段」（app_usage 行）
 * - 片段开启即 INSERT；之后每 ~60s 与收尾时 UPDATE end_at/seconds（崩溃最多丢一分钟）
 * - 收尾时机：切换应用 / 空闲超 idle_seconds（收在最后活跃时刻）/ 采样断档（睡眠）/ 停机
 */

const IGNORED_BUNDLES = new Set([
  "com.apple.loginwindow",
  "com.apple.ScreenSaver.Engine",
]);

const DB_UPDATE_INTERVAL_MS = 60_000;

interface Segment {
  id: string;
  bundleId: string;
  appName: string;
  startAt: Date;
  lastSeenAt: Date;
  lastDbWriteAt: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let current: Segment | null = null;
let lastSampleAt = 0;
let lastMediaAt = 0; // 最后一次检测到前台媒体播放的时刻
let sampling = false;

interface Sample {
  bundleId: string | null;
  appName: string | null;
  idleSeconds: number;
  mediaActive: boolean; // 前台应用持有防休眠断言（播放视频/通话中）
}

const SEP = "---ECHOLOG---";

/**
 * 前台应用是否持有电源断言（视频播放、音视频通话时，
 * Chrome/微信/播放器等会挂 PreventUserIdleDisplaySleep 或 PreventUserIdleSystemSleep）。
 * 持有则视为「在用」，即便键鼠无输入——否则看片、开会的时间会被空闲判定整段丢掉。
 */
function frontAppHoldsAssertion(
  pm: string,
  bundleId: string | null,
  appName: string | null
): boolean {
  if (!pm || !bundleId) return false;
  const bid = bundleId.toLowerCase();
  const app = (appName ?? "").toLowerCase();
  const re =
    /pid \d+\(([^)]+)\):.*?(PreventUserIdleDisplaySleep|PreventUserIdleSystemSleep|NoIdleSleepAssertion)/g;
  for (const m of pm.matchAll(re)) {
    const proc = m[1].trim().toLowerCase();
    // 系统与代理进程的断言不代表前台应用在播放
    if (!proc || proc === "caffeinate" || proc === "powerd" || proc === "coreaudiod") continue;
    if (bid.includes(proc) || app.includes(proc) || (app && proc.includes(app))) {
      return true;
    }
  }
  return false;
}

async function takeSample(): Promise<Sample> {
  const cmd =
    `lsappinfo info -only name -only bundleid "$(lsappinfo front)" 2>/dev/null; ` +
    `echo ${SEP}; ` +
    `ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print $NF; exit}'; ` +
    `echo ${SEP}; ` +
    `pmset -g assertions 2>/dev/null`;
  const { stdout } = await execAsync(cmd, { timeout: 4000 });
  const [appPart = "", idlePart = "", pmPart = ""] = stdout.split(
    new RegExp(`${SEP}\\n?`)
  );
  const nameMatch = appPart.match(/"LSDisplayName"="(.*)"/);
  const bundleMatch = appPart.match(/"CFBundleIdentifier"="(.*)"/);
  const idleMatch = idlePart.match(/(\d+)/);
  const bundleId = bundleMatch?.[1] ?? null;
  const appName = nameMatch?.[1] ?? bundleId;
  return {
    bundleId,
    appName,
    idleSeconds: idleMatch ? Number(idleMatch[1]) / 1e9 : 0,
    mediaActive: frontAppHoldsAssertion(pmPart, bundleId, appName),
  };
}

function segmentSeconds(seg: Segment, until: Date): number {
  return Math.max(
    0,
    Math.round((until.getTime() - seg.startAt.getTime()) / 1000)
  );
}

async function openSegment(
  bundleId: string,
  appName: string,
  at: Date
): Promise<void> {
  const seg: Segment = {
    id: nanoid(12),
    bundleId,
    appName,
    startAt: at,
    lastSeenAt: at,
    lastDbWriteAt: Date.now(),
  };
  await getDb().insert(appUsage).values({
    id: seg.id,
    bundleId,
    appName,
    startAt: at,
    endAt: at,
    seconds: 0,
  });
  current = seg;
}

async function writeSegment(seg: Segment, endAt: Date): Promise<void> {
  await getDb()
    .update(appUsage)
    .set({ endAt, seconds: segmentSeconds(seg, endAt) })
    .where(eq(appUsage.id, seg.id));
  seg.lastDbWriteAt = Date.now();
}

async function closeSegment(endAt: Date): Promise<void> {
  if (!current) return;
  const seg = current;
  current = null;
  // 收尾时刻不得早于开始时刻
  const at = endAt.getTime() < seg.startAt.getTime() ? seg.startAt : endAt;
  await writeSegment(seg, at);
}

async function onSample(): Promise<void> {
  const config = loadConfig();
  const sampleMs = (config.tracker?.sample_seconds ?? 5) * 1000;
  const idleLimit = config.tracker?.idle_seconds ?? 180;

  const now = new Date();
  const nowMs = now.getTime();

  // 采样断档（睡眠/合盖）：在最后活跃时刻收尾
  if (current && lastSampleAt && nowMs - lastSampleAt > sampleMs * 3) {
    await closeSegment(current.lastSeenAt);
  }
  lastSampleAt = nowMs;

  const s = await takeSample();
  if (s.mediaActive) lastMediaAt = nowMs;

  // 空闲超限且前台无媒体播放：视为离开。
  // 收尾点取「最后一次输入」与「最后一次媒体活跃」的较晚者——
  // 否则刚看完的一整段视频会被回溯抹掉（看片全程键鼠无输入）。
  if (s.idleSeconds >= idleLimit && !s.mediaActive) {
    if (current) {
      const inputCutoff = nowMs - s.idleSeconds * 1000;
      const at = new Date(Math.max(inputCutoff, lastMediaAt));
      const name = current.appName;
      const secs = segmentSeconds(current, at);
      await closeSegment(at);
      console.log(`tracker: idle-closed ${name} (${secs}s)`);
    }
    return;
  }

  const active =
    s.bundleId && !IGNORED_BUNDLES.has(s.bundleId) ? s.bundleId : null;

  if (!active) {
    if (current) await closeSegment(now);
    return;
  }

  if (current && current.bundleId === active) {
    current.lastSeenAt = now;
    if (Date.now() - current.lastDbWriteAt >= DB_UPDATE_INTERVAL_MS) {
      await writeSegment(current, now);
    }
    return;
  }

  if (current) await closeSegment(now);
  await openSegment(active, s.appName ?? active, now);
}

export function startTracker(): void {
  const config = loadConfig();
  if (process.platform !== "darwin") return;
  if (config.tracker && config.tracker.enabled === false) return;
  if (timer) return;

  const sampleMs = (config.tracker?.sample_seconds ?? 5) * 1000;
  let failStreak = 0;
  timer = setInterval(async () => {
    if (sampling) return; // 防重入
    sampling = true;
    try {
      await onSample();
      failStreak = 0;
    } catch (err) {
      // exec 超时或 DB 暂时不可用：跳过本轮，片段留在内存下轮重试
      failStreak++;
      if (failStreak === 5) {
        console.error(
          `tracker: sampling failed ${failStreak}x in a row:`,
          err instanceof Error ? err.message : err
        );
      }
    } finally {
      sampling = false;
    }
  }, sampleMs);
  console.log(`Screen tracker started (sample ${sampleMs / 1000}s)`);
}

export async function stopTracker(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    // 收在最后一次确认在用的时刻，避免把停机前的挂机尾巴计进去
    await closeSegment(current ? current.lastSeenAt : new Date());
  } catch {
    // 关停途中 DB 已不可用则放弃收尾
  }
}

/** 当前进行中的片段（内存态，端到端实时；无片段时为 null） */
export function getCurrentSegment(): {
  id: string;
  bundleId: string;
  appName: string;
  startAt: Date;
  lastSeenAt: Date;
} | null {
  if (!current) return null;
  const { id, bundleId, appName, startAt, lastSeenAt } = current;
  return { id, bundleId, appName, startAt, lastSeenAt };
}
