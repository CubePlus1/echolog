import { useState } from "react";
import type { Record as TaskRecord } from "../api";
import { api } from "../api";
import Timer from "./Timer";

const typeConfig: {
  [k: string]: { label: string; color: string; dimColor: string };
} = {
  learning: {
    label: "学习",
    color: "var(--learning)",
    dimColor: "var(--learning-dim)",
  },
  project: {
    label: "项目",
    color: "var(--project)",
    dimColor: "var(--project-dim)",
  },
  task: {
    label: "任务",
    color: "var(--task)",
    dimColor: "var(--task-dim)",
  },
};

export default function TaskCard({
  record,
  onUpdate,
  index = 0,
}: {
  record: TaskRecord;
  onUpdate: () => void;
  index?: number;
}) {
  const isRunning = record.status === "running";
  const isPaused = record.status === "paused";
  const [stopping, setStopping] = useState(false);
  const [resultText, setResultText] = useState("");
  const config = typeConfig[record.type] ?? typeConfig.task;

  const handlePauseResume = async () => {
    try {
      if (isRunning) await api.pauseRecord(record.id);
      else if (isPaused) await api.resumeRecord(record.id);
    } catch (err: any) {
      alert(err.message ?? "操作失败");
    }
    onUpdate();
  };

  const handleStop = async () => {
    if (!stopping) {
      setStopping(true);
      return;
    }
    try {
      await api.stopRecord(record.id, resultText.trim() || undefined);
    } catch (err: any) {
      alert(err.message ?? "停止失败");
    }
    setStopping(false);
    onUpdate();
  };

  const handleCancelStop = () => {
    setStopping(false);
    setResultText("");
  };

  return (
    <div
      className="animate-slide-up"
      style={{
        animationDelay: `${index * 60}ms`,
        background: "var(--surface)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--border-subtle)",
        padding: "20px",
        transition: "border-color var(--transition), box-shadow var(--transition)",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.boxShadow = "var(--shadow-card)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-subtle)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {isRunning && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: config.color,
            borderRadius: "0 2px 2px 0",
          }}
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.7rem",
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: config.color,
                background: config.dimColor,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
              }}
            >
              {config.label}
            </span>
            {record.project && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                {record.project}
              </span>
            )}
            <div style={{ position: "relative", width: 8, height: 8, marginLeft: "auto", flexShrink: 0 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: isRunning ? "var(--learning)" : "var(--task)",
                }}
              />
              {isRunning && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background: "var(--learning)",
                    animation: "pulse-ring 2s ease-out infinite",
                  }}
                />
              )}
            </div>
          </div>

          <h3
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "1.05rem",
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.4,
            }}
          >
            {record.title}
          </h3>

          {record.tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {record.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-tertiary)",
                    background: "oklch(0.22 0.010 var(--hue-neutral))",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-pill)",
                    letterSpacing: "0.02em",
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <Timer
          lastResumedAt={record.lastResumedAt ?? record.startAt}
          paused={isPaused}
          liveDurationSeconds={
            record.liveDurationSeconds ?? record.durationSeconds
          }
        />
      </div>

      {stopping ? (
        <div
          className="animate-fade-in"
          style={{ marginTop: 16, display: "flex", gap: 8 }}
        >
          <input
            type="text"
            value={resultText}
            onChange={(e) => setResultText(e.target.value)}
            placeholder="结果总结（可留空）"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleStop();
              if (e.key === "Escape") handleCancelStop();
            }}
            style={{
              flex: 1,
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-input)",
              padding: "8px 12px",
              color: "var(--text)",
              outline: "none",
              transition: "border-color var(--transition)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
          <ActionButton color="var(--danger)" onClick={handleStop}>
            确认停止
          </ActionButton>
          <ActionButton color="var(--text-tertiary)" onClick={handleCancelStop} ghost>
            取消
          </ActionButton>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <ActionButton
            color={isRunning ? "var(--task)" : "var(--learning)"}
            onClick={handlePauseResume}
          >
            {isRunning ? "暂停" : "恢复"}
          </ActionButton>
          <ActionButton color="var(--danger)" onClick={handleStop} ghost>
            停止
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children,
  color,
  onClick,
  ghost = false,
  disabled = false,
}: {
  children: React.ReactNode;
  color: string;
  onClick: () => void;
  ghost?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "0.8rem",
        fontWeight: 500,
        padding: "7px 16px",
        borderRadius: "var(--radius-btn)",
        border: ghost ? `1px solid oklch(0.30 0.010 var(--hue-neutral))` : "none",
        background: ghost ? "transparent" : color,
        color: ghost ? color : "oklch(0.98 0 0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all var(--transition)",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.filter = "brightness(1.1)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.filter = "brightness(1)";
      }}
    >
      {children}
    </button>
  );
}
