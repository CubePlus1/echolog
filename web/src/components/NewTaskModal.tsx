import { useState } from "react";
import { api } from "../api";

const typeOptions = [
  { value: "learning" as const, label: "学习", color: "var(--learning)" },
  { value: "project" as const, label: "项目", color: "var(--project)" },
  { value: "task" as const, label: "任务", color: "var(--task)" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-body)",
  fontSize: "0.9rem",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-input)",
  padding: "10px 14px",
  color: "var(--text)",
  outline: "none",
  transition: "border-color var(--transition)",
};

export default function NewTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"learning" | "project" | "task">("task");
  const [tags, setTags] = useState("");
  const [project, setProject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await api.startRecord({
        title: title.trim(),
        type,
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        project: project.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0 0 0 / 0.6)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        animation: "fade-in 200ms ease-out",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="animate-fade-in"
        style={{
          background: "var(--surface)",
          borderRadius: "calc(var(--radius-card) + 4px)",
          border: "1px solid var(--border)",
          padding: "28px",
          width: "100%",
          maxWidth: 440,
          boxShadow: "var(--shadow-modal)",
          animationDelay: "50ms",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 20,
          }}
        >
          开始新任务
        </h2>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            标题
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            placeholder="学习 Java HashMap"
            autoFocus
            onFocus={(e) => (e.target.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 8 }}>
            类型
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setType(opt.value)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.82rem",
                  fontWeight: 500,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-btn)",
                  border:
                    type === opt.value
                      ? `1.5px solid ${opt.color}`
                      : "1.5px solid var(--border)",
                  background:
                    type === opt.value
                      ? `color-mix(in oklch, ${opt.color} 12%, transparent)`
                      : "transparent",
                  color: type === opt.value ? opt.color : "var(--text-secondary)",
                  cursor: "pointer",
                  transition: "all var(--transition)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            标签
          </label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            style={inputStyle}
            placeholder="java, 学习"
            onFocus={(e) => (e.target.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
            项目
          </label>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            style={inputStyle}
            placeholder="eoove"
            onFocus={(e) => (e.target.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
          />
        </div>

        {error && (
          <div
            style={{
              fontSize: "0.82rem",
              color: "var(--danger)",
              marginBottom: 14,
              padding: "8px 12px",
              background: "var(--danger-dim)",
              borderRadius: "var(--radius-btn)",
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              padding: "9px 18px",
              borderRadius: "var(--radius-btn)",
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              transition: "color var(--transition)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-tertiary)")}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.85rem",
              fontWeight: 600,
              padding: "9px 24px",
              borderRadius: "var(--radius-btn)",
              border: "none",
              background: "var(--primary)",
              color: "oklch(0.98 0 0)",
              cursor: !title.trim() || submitting ? "not-allowed" : "pointer",
              opacity: !title.trim() || submitting ? 0.5 : 1,
              transition: "all var(--transition)",
            }}
            onMouseEnter={(e) => {
              if (title.trim() && !submitting) {
                e.currentTarget.style.filter = "brightness(1.15)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = "brightness(1)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            {submitting ? "启动中..." : "开始记录"}
          </button>
        </div>
      </form>
    </div>
  );
}
