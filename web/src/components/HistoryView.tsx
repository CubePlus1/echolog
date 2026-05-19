import { useState, useEffect } from "react";
import { api } from "../api";
import type { Record } from "../api";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const typeConfig: { [k: string]: { label: string; color: string; dimColor: string } } = {
  learning: { label: "学习", color: "var(--learning)", dimColor: "var(--learning-dim)" },
  project: { label: "项目", color: "var(--project)", dimColor: "var(--project-dim)" },
  task: { label: "任务", color: "var(--task)", dimColor: "var(--task-dim)" },
};

const statusLabel: { [k: string]: { text: string; color: string } } = {
  done: { text: "完成", color: "var(--learning)" },
  running: { text: "进行中", color: "var(--primary)" },
  paused: { text: "暂停", color: "var(--task)" },
  cancelled: { text: "取消", color: "var(--text-tertiary)" },
};

export default function HistoryView() {
  const [date, setDate] = useState(localDateStr());
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalSeconds, setTotalSeconds] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.getDailySummary(date).then((data) => {
      setRecords(data.records);
      setTotalSeconds(data.totalSeconds);
      setLoading(false);
    }).catch(() => {
      setRecords([]);
      setTotalSeconds(0);
      setLoading(false);
    });
  }, [date]);

  const shiftDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(localDateStr(d));
  };

  const isToday = date === localDateStr();

  return (
    <div className="animate-fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NavBtn onClick={() => shiftDate(-1)}>&larr;</NavBtn>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.85rem",
              fontWeight: 500,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-btn)",
              padding: "6px 12px",
              color: "var(--text)",
              outline: "none",
              colorScheme: "dark",
            }}
          />
          <NavBtn onClick={() => shiftDate(1)} disabled={isToday}>&rarr;</NavBtn>
          {!isToday && (
            <button
              onClick={() => setDate(localDateStr())}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.72rem",
                color: "var(--primary)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              今天
            </button>
          )}
        </div>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          {formatDuration(totalSeconds)}
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)", fontSize: "0.85rem" }}>
          加载中...
        </div>
      ) : records.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-tertiary)" }}>
          <p style={{ fontSize: "0.9rem" }}>这一天没有记录</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {records.map((r, i) => {
            const tc = typeConfig[r.type] ?? typeConfig.task;
            const st = statusLabel[r.status] ?? statusLabel.done;
            return (
              <div
                key={r.id}
                className="animate-slide-up"
                style={{
                  animationDelay: `${i * 30}ms`,
                  display: "grid",
                  gridTemplateColumns: "56px 1fr auto",
                  gap: 14,
                  alignItems: "start",
                  padding: "14px 16px",
                  borderRadius: 12,
                  transition: "background var(--transition)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--text-tertiary)", paddingTop: 2 }}>
                  {formatTime(r.startAt)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: "0.88rem",
                        fontWeight: 600,
                        color: r.status === "cancelled" ? "var(--text-tertiary)" : "var(--text)",
                        textDecoration: r.status === "cancelled" ? "line-through" : "none",
                      }}
                    >
                      {r.title}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: 500,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: tc.color,
                        background: tc.dimColor,
                        padding: "2px 8px",
                        borderRadius: "var(--radius-pill)",
                      }}
                    >
                      {tc.label}
                    </span>
                    {r.project && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-tertiary)" }}>
                        {r.project}
                      </span>
                    )}
                    {r.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: "0.65rem",
                          color: "var(--text-tertiary)",
                          background: "oklch(0.22 0.010 var(--hue-neutral))",
                          padding: "1px 7px",
                          borderRadius: "var(--radius-pill)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {r.result && (
                    <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                      {r.result}
                    </p>
                  )}
                </div>

                <div style={{ textAlign: "right", flexShrink: 0, paddingTop: 2 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                    {formatDuration(r.durationSeconds)}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: st.color, marginTop: 2 }}>
                    {st.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavBtn({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "0.85rem",
        width: 32,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "transparent",
        color: disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all var(--transition)",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "var(--surface)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}
