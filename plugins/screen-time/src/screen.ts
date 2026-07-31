import type { AppRule } from "./schema.js";
import type { CreateRuleInput, ScreenStore } from "./store.js";
import type { ScreenTracker } from "./tracker.js";

export const UNCLASSIFIED = "未分";

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

function ruleMatchesApp(rule: AppRule, bundleId: string, appName: string): boolean {
  const match = rule.appMatch.toLowerCase();
  return (
    bundleId.toLowerCase().includes(match) ||
    appName.toLowerCase().includes(match)
  );
}

function ruleAppliesAt(rule: AppRule, time: Date): boolean {
  if (rule.weekdays?.length && !rule.weekdays.includes(time.getDay())) {
    return false;
  }
  if (rule.startMinute == null || rule.endMinute == null) return true;
  const minute =
    time.getHours() * 60 + time.getMinutes() + time.getSeconds() / 60;
  if (rule.startMinute < rule.endMinute) {
    return minute >= rule.startMinute && minute < rule.endMinute;
  }
  if (rule.startMinute > rule.endMinute) {
    return minute >= rule.startMinute || minute < rule.endMinute;
  }
  return true;
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function boundariesWithin(rules: AppRule[], start: Date, end: Date): Date[] {
  const boundaries: Date[] = [];
  const day = localMidnight(start);
  while (day.getTime() < end.getTime()) {
    if (day.getTime() > start.getTime()) boundaries.push(new Date(day));
    for (const rule of rules) {
      if (rule.startMinute == null || rule.endMinute == null) continue;
      for (const minute of [rule.startMinute, rule.endMinute]) {
        const boundary = new Date(day.getTime() + minute * 60_000);
        if (
          boundary.getTime() > start.getTime() &&
          boundary.getTime() < end.getTime()
        ) {
          boundaries.push(boundary);
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return [...new Set(boundaries.map((date) => date.getTime()))]
    .sort((a, b) => a - b)
    .map((time) => new Date(time));
}

function pickRule(candidates: AppRule[]): AppRule | null {
  return candidates.slice().sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aWindowed = a.startMinute != null ? 1 : 0;
    const bWindowed = b.startMinute != null ? 1 : 0;
    if (bWindowed !== aWindowed) return bWindowed - aWindowed;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0] ?? null;
}

export function classifySegment(
  rules: AppRule[],
  segment: { bundleId: string; appName: string; startAt: Date; endAt: Date }
): ClassifiedSlice[] {
  const matching = rules.filter((rule) =>
    ruleMatchesApp(rule, segment.bundleId, segment.appName)
  );
  const cuts = [
    segment.startAt,
    ...boundariesWithin(matching, segment.startAt, segment.endAt),
    segment.endAt,
  ];
  const slices: ClassifiedSlice[] = [];

  for (let index = 0; index < cuts.length - 1; index++) {
    const startAt = cuts[index];
    const endAt = cuts[index + 1];
    if (endAt.getTime() <= startAt.getTime()) continue;
    const middle = new Date((startAt.getTime() + endAt.getTime()) / 2);
    const rule = pickRule(
      matching.filter((candidate) => ruleAppliesAt(candidate, middle))
    );
    const label = rule?.label ?? UNCLASSIFIED;
    const previous = slices[slices.length - 1];
    if (previous?.label === label) {
      previous.endAt = endAt;
      previous.seconds = Math.round(
        (endAt.getTime() - previous.startAt.getTime()) / 1000
      );
    } else {
      slices.push({
        bundleId: segment.bundleId,
        appName: segment.appName,
        startAt,
        endAt,
        seconds: Math.round((endAt.getTime() - startAt.getTime()) / 1000),
        label,
      });
    }
  }
  return slices;
}

export class ScreenService {
  constructor(
    private readonly store: ScreenStore,
    private readonly tracker: ScreenTracker
  ) {}

  async getDaily(date: string): Promise<DailyScreen> {
    const dayStart = new Date(`${date}T00:00:00.000`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [rows, rules] = await Promise.all([
      this.store.usageBetween(dayStart, dayEnd),
      this.store.listRules(),
    ]);

    const live = this.tracker.currentSegment();
    if (live) {
      const row = rows.find((item) => item.id === live.id);
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

    const segments = rows.flatMap((row) => {
      const startAt = row.startAt < dayStart ? dayStart : row.startAt;
      const endAt = row.endAt > dayEnd ? dayEnd : row.endAt;
      return endAt > startAt
        ? classifySegment(rules, {
            bundleId: row.bundleId,
            appName: row.appName,
            startAt,
            endAt,
          })
        : [];
    });

    const byLabel = new Map<string, number>();
    const apps = new Map<
      string,
      { appName: string; seconds: number; byLabel: Record<string, number> }
    >();
    let totalSeconds = 0;
    for (const segment of segments) {
      totalSeconds += segment.seconds;
      byLabel.set(
        segment.label,
        (byLabel.get(segment.label) ?? 0) + segment.seconds
      );
      const app = apps.get(segment.bundleId) ?? {
        appName: segment.appName,
        seconds: 0,
        byLabel: {},
      };
      app.appName = segment.appName;
      app.seconds += segment.seconds;
      app.byLabel[segment.label] =
        (app.byLabel[segment.label] ?? 0) + segment.seconds;
      apps.set(segment.bundleId, app);
    }

    return {
      date,
      totalSeconds,
      byLabel: [...byLabel.entries()]
        .map(([label, seconds]) => ({ label, seconds }))
        .sort((a, b) => b.seconds - a.seconds),
      apps: [...apps.entries()]
        .map(([bundleId, app]) => ({ bundleId, ...app }))
        .sort((a, b) => b.seconds - a.seconds),
      segments,
    };
  }

  listRules() {
    return this.store.listRules();
  }

  createRule(input: CreateRuleInput) {
    return this.store.createRule(input);
  }

  deleteRule(id: string) {
    return this.store.deleteRule(id);
  }
}
