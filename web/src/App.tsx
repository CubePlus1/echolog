import { useState, useEffect, useCallback } from "react";
import { api } from "./api";
import type { Record, TodaySummary as SummaryType } from "./api";
import TaskCard from "./components/TaskCard";
import NewTaskModal from "./components/NewTaskModal";
import TodaySummary from "./components/TodaySummary";

export default function App() {
  const [active, setActive] = useState<Record[]>([]);
  const [summary, setSummary] = useState<SummaryType | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [activeData, summaryData] = await Promise.all([
        api.getActive(),
        api.getTodaySummary(),
      ]);
      setActive(activeData);
      setSummary(summaryData);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? "连接失败");
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !showNew) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        setShowNew(true);
      }
      if (e.key === "Escape" && showNew) setShowNew(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showNew]);

  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px 20px",
        maxWidth: 640,
        margin: "0 auto",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 32,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.6rem",
              fontWeight: 700,
              color: "var(--text)",
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            EchoLog
          </h1>
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--text-tertiary)",
              marginTop: 6,
            }}
          >
            {dateStr}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "0.82rem",
            fontWeight: 600,
            padding: "9px 20px",
            borderRadius: "var(--radius-btn)",
            border: "none",
            background: "var(--primary)",
            color: "oklch(0.98 0 0)",
            cursor: "pointer",
            transition: "all var(--transition)",
            boxShadow: "0 2px 12px var(--primary-glow)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = "brightness(1.12)";
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              "0 4px 20px oklch(0.65 0.15 var(--hue-primary) / 0.25)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = "brightness(1)";
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 2px 12px var(--primary-glow)";
          }}
        >
          开始新任务
          <span
            style={{
              marginLeft: 8,
              fontSize: "0.7rem",
              opacity: 0.6,
              fontFamily: "var(--font-mono)",
            }}
          >
            N
          </span>
        </button>
      </header>

      {error && (
        <div
          className="animate-fade-in"
          style={{
            fontSize: "0.82rem",
            color: "var(--danger)",
            background: "var(--danger-dim)",
            border: "1px solid oklch(0.65 0.20 var(--hue-danger) / 0.2)",
            borderRadius: "var(--radius-btn)",
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {summary && <TodaySummary summary={summary} />}

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {active.length === 0 ? (
          <div
            className="animate-fade-in"
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "var(--text-tertiary)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--surface)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: "1.2rem",
                color: "var(--text-tertiary)",
              }}
            >
              ·
            </div>
            <p style={{ fontSize: "0.95rem", marginBottom: 6 }}>
              没有进行中的任务
            </p>
            <p style={{ fontSize: "0.78rem", opacity: 0.7 }}>
              按{" "}
              <kbd
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "2px 7px",
                }}
              >
                N
              </kbd>{" "}
              开始记录，或使用{" "}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  background: "var(--surface)",
                  padding: "2px 7px",
                  borderRadius: 5,
                }}
              >
                el start
              </code>
            </p>
          </div>
        ) : (
          active.map((record, i) => (
            <TaskCard key={record.id} record={record} onUpdate={refresh} index={i} />
          ))
        )}
      </div>

      {showNew && (
        <NewTaskModal onClose={() => setShowNew(false)} onCreated={refresh} />
      )}
    </div>
  );
}
