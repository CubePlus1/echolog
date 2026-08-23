import type {
  FlowSettings,
  FlowSource,
  Inspiration,
} from "./types.js";

export interface SelectableInspiration {
  inspiration: Inspiration;
  snoozedUntil: Date | null;
}

export interface FlowSelectionInput {
  candidates: SelectableInspiration[];
  settings: FlowSettings;
  source: FlowSource;
  now: Date;
  surfacedToday: number;
}

export interface FlowSelectionResult {
  selected: SelectableInspiration | null;
  explanation: string[];
  excluded: Record<string, string[]>;
}

export function minuteOfLocalDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function isQuietMinute(
  minute: number,
  startMinute: number,
  endMinute: number
): boolean {
  // Equal endpoints intentionally disable quiet hours. This makes the
  // singleton setting able to represent "no quiet period" without another
  // nullable/configuration flag.
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}

export function candidateExclusionReasons(
  candidate: SelectableInspiration,
  settings: FlowSettings,
  now: Date
): string[] {
  const { inspiration, snoozedUntil } = candidate;
  const reasons: string[] = [];

  if (inspiration.status === "archived") {
    reasons.push("lifecycle:archived");
  } else if (!settings.statuses.includes(inspiration.status)) {
    reasons.push(`filter:status:${inspiration.status}`);
  }

  if (
    settings.tags.length > 0 &&
    !settings.tags.every((tag) => inspiration.tags.includes(tag))
  ) {
    reasons.push("filter:tags");
  }

  if (
    settings.projects.length > 0 &&
    (inspiration.project === null ||
      !settings.projects.includes(inspiration.project))
  ) {
    reasons.push("filter:project");
  }

  if (snoozedUntil && snoozedUntil.getTime() > now.getTime()) {
    reasons.push(`delivery:snoozed-until:${snoozedUntil.toISOString()}`);
  }

  if (inspiration.lastSurfacedAt && settings.cooldownMinutes > 0) {
    const eligibleAt = new Date(
      inspiration.lastSurfacedAt.getTime() + settings.cooldownMinutes * 60_000
    );
    if (eligibleAt.getTime() > now.getTime()) {
      reasons.push(`policy:cooldown-until:${eligibleAt.toISOString()}`);
    }
  }

  return reasons;
}

export function compareSelectableInspirations(
  left: SelectableInspiration,
  right: SelectableInspiration
): number {
  const leftSurfaced = left.inspiration.lastSurfacedAt?.getTime();
  const rightSurfaced = right.inspiration.lastSurfacedAt?.getTime();
  if (leftSurfaced === undefined && rightSurfaced !== undefined) return -1;
  if (leftSurfaced !== undefined && rightSurfaced === undefined) return 1;
  if (leftSurfaced !== rightSurfaced) {
    return (leftSurfaced ?? 0) - (rightSurfaced ?? 0);
  }

  const createdDifference =
    left.inspiration.createdAt.getTime() - right.inspiration.createdAt.getTime();
  if (createdDifference !== 0) return createdDifference;
  if (left.inspiration.id === right.inspiration.id) return 0;
  return left.inspiration.id < right.inspiration.id ? -1 : 1;
}

export function selectFlowCandidate(
  input: FlowSelectionInput
): FlowSelectionResult {
  const globalReasons: string[] = [];
  if (input.source === "scheduled") {
    if (!input.settings.enabled) globalReasons.push("policy:disabled");
    if (
      isQuietMinute(
        minuteOfLocalDay(input.now),
        input.settings.quietStartMinute,
        input.settings.quietEndMinute
      )
    ) {
      globalReasons.push("policy:quiet-hours");
    }
  }
  if (input.surfacedToday >= input.settings.dailyLimit) {
    globalReasons.push("policy:daily-limit");
  }

  const excluded: Record<string, string[]> = {};
  const eligible: SelectableInspiration[] = [];
  for (const candidate of input.candidates) {
    const reasons = candidateExclusionReasons(
      candidate,
      input.settings,
      input.now
    );
    if (reasons.length === 0) eligible.push(candidate);
    else excluded[candidate.inspiration.id] = reasons;
  }
  const excludedExplanations = Object.entries(excluded).flatMap(
    ([id, reasons]) => reasons.map((reason) => `excluded:${id}:${reason}`)
  );

  if (globalReasons.length > 0) {
    return {
      selected: null,
      explanation: [...globalReasons, ...excludedExplanations],
      excluded,
    };
  }
  if (eligible.length === 0) {
    return {
      selected: null,
      explanation: input.candidates.length === 0
        ? ["selection:no-inspirations"]
        : ["selection:no-eligible-inspirations", ...excludedExplanations],
      excluded,
    };
  }

  eligible.sort(compareSelectableInspirations);
  const selected = eligible[0]!;
  const rankReason = selected.inspiration.lastSurfacedAt === null
    ? "selection:never-surfaced-first"
    : "selection:oldest-last-surfaced-first";
  return {
    selected,
    explanation: [
      rankReason,
      "selection:tiebreak-created-at-then-id",
      ...excludedExplanations,
    ],
    excluded,
  };
}
