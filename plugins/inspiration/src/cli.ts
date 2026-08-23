import type { DailyInspirationSummary, FlowOutcome } from "./types.js";

export const inspirationCliContribution = {
  command: "inspiration",
  apiPrefix: "/api/plugins/inspiration",
} as const;

const OUTCOME_LABELS: Record<FlowOutcome, string> = {
  viewed: "查看",
  continued: "继续编辑",
  kept: "保留",
  later: "稍后",
  archived: "归档",
};
const OUTCOME_ORDER = Object.keys(OUTCOME_LABELS) as FlowOutcome[];

/** Render aggregate counts only; inspiration bodies never enter daily reports. */
export function renderInspirationDailySummary(
  summary: DailyInspirationSummary
): string | null {
  const outcomes = OUTCOME_ORDER.flatMap((outcome) => {
    const count = summary.outcomes[outcome];
    return typeof count === "number" && count > 0
      ? [`${OUTCOME_LABELS[outcome]} ${count}`]
      : [];
  });
  if (summary.captured === 0 && summary.surfaced === 0 && outcomes.length === 0) {
    return null;
  }
  return [
    `捕捉 ${summary.captured} 条，Flow 浮现 ${summary.surfaced} 次。`,
    ...(outcomes.length > 0 ? [`结果：${outcomes.join("、")}。`] : []),
  ].join("\n");
}
