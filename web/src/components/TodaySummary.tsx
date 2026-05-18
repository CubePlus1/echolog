import type { TodaySummary as SummaryType } from "../api";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function percent(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

export default function TodaySummary({ summary }: { summary: SummaryType }) {
  const { totalSeconds, recordCount, byType } = summary;

  const segments = [
    { label: "学习", seconds: byType.learning, color: "bg-emerald-500" },
    { label: "项目", seconds: byType.project, color: "bg-blue-500" },
    { label: "任务", seconds: byType.task, color: "bg-amber-500" },
  ].filter((s) => s.seconds > 0);

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
      <h2 className="text-sm text-slate-400 mb-2">今日概览</h2>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-3xl font-bold text-white">
          {formatDuration(totalSeconds)}
        </span>
        <span className="text-sm text-slate-400">{recordCount} 条记录</span>
      </div>

      {totalSeconds > 0 && (
        <>
          <div className="flex h-3 rounded-full overflow-hidden mb-3">
            {segments.map((s) => (
              <div
                key={s.label}
                className={`${s.color} transition-all`}
                style={{ width: `${percent(s.seconds, totalSeconds)}%` }}
              />
            ))}
          </div>
          <div className="flex gap-4">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                <span className="text-xs text-slate-400">
                  {s.label} {formatDuration(s.seconds)} (
                  {percent(s.seconds, totalSeconds)}%)
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
