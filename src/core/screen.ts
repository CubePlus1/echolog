import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";
import { appRules, appUsage } from "./schema.js";
import type { AppRule } from "./schema.js";
import { getCurrentSegment } from "./tracker.js";

/**
 * 屏幕使用查询与分类
 * 分类在查询时计算：把使用片段按「命中规则的时段边界」切开，
 * 每一片取 priority 最高的适用规则的 label（平局：有时段的规则 > 全天规则，再新者胜）。
 * 无适用规则 → 「未分」。
 */

export const UNCLASSIFIED = "未分";

export class RuleNotFoundError extends Error {
  constructor(id: string) {
    super(`Rule ${id} not found`);
    this.name = "RuleNotFoundError";
  }
}

export interface ClassifiedSlice {
  bundleId: string;
  appName: string;
  startAt: Date;
  endAt: Date;
  seconds: number;
  label: string;
}

export interface DailyScreen {
  date: string;
  totalSeconds: number;
  byLabel: { label: string; seconds: number }[];
  apps: {
    bundleId: string;
    appName: string;
    seconds: number;
    byLabel: Record<string, number>;
  }[];
  segments: ClassifiedSlice[];
}

/* ---------------- 规则匹配 ---------------- */

function ruleMatchesApp(rule: AppRule, bundleId: string, appName: string): boolean {
  const m = rule.appMatch.toLowerCase();
  return (
    bundleId.toLowerCase().includes(m) || appName.toLowerCase().includes(m)
  );
}

/** 该时刻此规则是否适用（本地时区；跨夜窗口 start>end 表示如 22:00–02:00） */
function ruleAppliesAt(rule: AppRule, t: Date): boolean {
  if (rule.weekdays && rule.weekdays.length > 0) {
    if (!rule.weekdays.includes(t.getDay())) return false;
  }
  if (rule.startMinute == null || rule.endMinute == null) return true;
  const m = t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60;
  const s = rule.startMinute;
  const e = rule.endMinute;
  if (s < e) return m >= s && m < e;
  if (s > e) return m >= s || m < e;
  return true; // s === e 视作全天（POST 校验层已拒绝，防御）
}

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 片段内所有「规则适用性可能翻转」的时刻：所触各天的 0 点与各规则窗口起止 */
function boundariesWithin(rules: AppRule[], start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const day = localMidnight(start);
  while (day.getTime() < end.getTime()) {
    if (day.getTime() > start.getTime()) out.push(new Date(day));
    for (const r of rules) {
      if (r.startMinute == null || r.endMinute == null) continue;
      for (const minute of [r.startMinute, r.endMinute]) {
        const t = new Date(day.getTime() + minute * 60_000);
        if (t.getTime() > start.getTime() && t.getTime() < end.getTime()) {
          out.push(t);
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return [...new Set(out.map((d) => d.getTime()))]
    .sort((a, b) => a - b)
    .map((t) => new Date(t));
}

/** 平局决胜：priority 高者胜 → 有时段者胜全天 → 新建者胜 */
function pickRule(candidates: AppRule[]): AppRule | null {
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aWin = a.startMinute != null ? 1 : 0;
    const bWin = b.startMinute != null ? 1 : 0;
    if (bWin !== aWin) return bWin - aWin;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

function classifySegment(
  rules: AppRule[],
  seg: { bundleId: string; appName: string; startAt: Date; endAt: Date }
): ClassifiedSlice[] {
  const matching = rules.filter((r) =>
    ruleMatchesApp(r, seg.bundleId, seg.appName)
  );
  const cuts = [
    seg.startAt,
    ...boundariesWithin(matching, seg.startAt, seg.endAt),
    seg.endAt,
  ];
  const slices: ClassifiedSlice[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b.getTime() <= a.getTime()) continue;
    const mid = new Date((a.getTime() + b.getTime()) / 2);
    const rule = pickRule(matching.filter((r) => ruleAppliesAt(r, mid)));
    const prevSlice = slices[slices.length - 1];
    const label = rule ? rule.label : UNCLASSIFIED;
    if (prevSlice && prevSlice.label === label) {
      // 相邻同 label 合并，减少碎片
      prevSlice.endAt = b;
      prevSlice.seconds = Math.round(
        (b.getTime() - prevSlice.startAt.getTime()) / 1000
      );
    } else {
      slices.push({
        bundleId: seg.bundleId,
        appName: seg.appName,
        startAt: a,
        endAt: b,
        seconds: Math.round((b.getTime() - a.getTime()) / 1000),
        label,
      });
    }
  }
  return slices;
}

/* ---------------- 查询 ---------------- */

export async function getDailyScreen(date: string): Promise<DailyScreen> {
  const db = getDb();
  const dayStart = new Date(`${date}T00:00:00.000`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [rows, rules] = await Promise.all([
    db
      .select()
      .from(appUsage)
      .where(and(gt(appUsage.endAt, dayStart), lt(appUsage.startAt, dayEnd)))
      .orderBy(asc(appUsage.startAt)),
    db.select().from(appRules),
  ]);

  // 今天的查询叠加内存中的实时片段（DB 里的 end_at 最多滞后一分钟）
  const live = getCurrentSegment();
  if (live) {
    const row = rows.find((r) => r.id === live.id);
    if (row) {
      if (live.lastSeenAt > row.endAt) row.endAt = live.lastSeenAt;
    } else if (live.startAt < dayEnd && live.lastSeenAt > dayStart) {
      rows.push({
        id: live.id,
        bundleId: live.bundleId,
        appName: live.appName,
        startAt: live.startAt,
        endAt: live.lastSeenAt,
        seconds: 0,
      });
    }
  }

  const slices: ClassifiedSlice[] = [];
  for (const row of rows) {
    // 裁剪到本日边界（跨夜片段只算本日部分）
    const s = row.startAt < dayStart ? dayStart : row.startAt;
    const e = row.endAt > dayEnd ? dayEnd : row.endAt;
    if (e.getTime() <= s.getTime()) continue;
    slices.push(
      ...classifySegment(rules, {
        bundleId: row.bundleId,
        appName: row.appName,
        startAt: s,
        endAt: e,
      })
    );
  }

  const byLabelMap = new Map<string, number>();
  const appMap = new Map<
    string,
    { appName: string; seconds: number; byLabel: Record<string, number> }
  >();
  let total = 0;
  for (const sl of slices) {
    total += sl.seconds;
    byLabelMap.set(sl.label, (byLabelMap.get(sl.label) ?? 0) + sl.seconds);
    let app = appMap.get(sl.bundleId);
    if (!app) {
      app = { appName: sl.appName, seconds: 0, byLabel: {} };
      appMap.set(sl.bundleId, app);
    }
    app.appName = sl.appName;
    app.seconds += sl.seconds;
    app.byLabel[sl.label] = (app.byLabel[sl.label] ?? 0) + sl.seconds;
  }

  return {
    date,
    totalSeconds: total,
    byLabel: [...byLabelMap.entries()]
      .map(([label, seconds]) => ({ label, seconds }))
      .sort((a, b) => b.seconds - a.seconds),
    apps: [...appMap.entries()]
      .map(([bundleId, a]) => ({ bundleId, ...a }))
      .sort((a, b) => b.seconds - a.seconds),
    segments: slices,
  };
}

/* ---------------- 规则 CRUD ---------------- */

export async function listRules(): Promise<AppRule[]> {
  const db = getDb();
  return db
    .select()
    .from(appRules)
    .orderBy(desc(appRules.priority), asc(appRules.createdAt));
}

export interface CreateRuleInput {
  appMatch: string;
  label: string;
  startMinute?: number | null;
  endMinute?: number | null;
  weekdays?: number[] | null;
  priority?: number;
}

export async function createRule(input: CreateRuleInput): Promise<AppRule> {
  const db = getDb();
  const [inserted] = await db
    .insert(appRules)
    .values({
      id: nanoid(12),
      appMatch: input.appMatch,
      label: input.label,
      startMinute: input.startMinute ?? null,
      endMinute: input.endMinute ?? null,
      weekdays: input.weekdays ?? null,
      priority: input.priority ?? 0,
      createdAt: new Date(),
    })
    .returning();
  return inserted;
}

export async function deleteRule(id: string): Promise<AppRule> {
  const db = getDb();
  const [deleted] = await db
    .delete(appRules)
    .where(eq(appRules.id, id))
    .returning();
  if (!deleted) throw new RuleNotFoundError(id);
  return deleted;
}
