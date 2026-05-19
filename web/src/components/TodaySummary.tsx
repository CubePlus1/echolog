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

const segments = [
  { key: "learning" as const, label: "学习", color: "var(--learning)" },
  { key: "project" as const, label: "项目", color: "var(--project)" },
  { key: "task" as const, label: "任务", color: "var(--task)" },
];

export default function TodaySummary({ summary }: { summary: SummaryType }) {
  const { totalSeconds, recordCount, byType } = summary;
  const activeSegments = segments.filter((s) => byType[s.key] > 0);

  return (
    <div
      className="animate-fade-in"
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--border-subtle)",
        padding: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: totalSeconds > 0 ? 20 : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "2.2rem",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "var(--text)",
            }}
          >
            {formatDuration(totalSeconds)}
          </span>
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-tertiary)",
            }}
          >
            {recordCount} 条记录
          </span>
        </div>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "0.7rem",
            fontWeight: 500,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          today
        </span>
      </div>

      {totalSeconds > 0 && (
        <>
          <div
            style={{
              display: "flex",
              height: 6,
              borderRadius: 99,
              overflow: "hidden",
              gap: 2,
              marginBottom: 14,
            }}
          >
            {activeSegments.map((s) => (
              <div
                key={s.key}
                style={{
                  background: s.color,
                  width: `${percent(byType[s.key], totalSeconds)}%`,
                  borderRadius: 99,
                  transition: "width 500ms ease-out",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 20 }}>
            {activeSegments.map((s) => (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: s.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {s.label}{" "}
                  <span style={{ color: "var(--text-tertiary)" }}>
                    {formatDuration(byType[s.key])} ({percent(byType[s.key], totalSeconds)}%)
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
