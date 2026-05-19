import { useState, useEffect, useCallback } from "react";
import { api } from "../api";

function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function simpleMarkdownToHtml(md: string): string {
  let html = md
    .replace(/^---[\s\S]*?---\n*/m, "")
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^\| (.+)$/gm, (_, row) => {
      const cells = row.split("|").map((c: string) => c.trim()).filter(Boolean);
      return `<tr>${cells.map((c: string) => `<td>${c}</td>`).join("")}</tr>`;
    })
    .replace(/^(<tr>.*<\/tr>\n?)+/gm, (block) => `<table>${block}</table>`)
    .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/<details>\n?<summary>(.+?)<\/summary>/g, '<details><summary>$1</summary>')
    .replace(/<!-- .+ -->/g, "");

  html = html.replace(/\n{2,}/g, "\n").split("\n").map((line) => {
    if (
      line.startsWith("<") ||
      line.trim() === "" ||
      line.startsWith("|---")
    ) return line;
    return `<p>${line}</p>`;
  }).join("\n");

  html = html.replace(/<p>\|---.*<\/p>/g, "");

  return html;
}

export default function ReportView() {
  const [date, setDate] = useState(localDateStr());
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.generateReport(date);
      setMarkdown(data.markdown);
    } catch (err: any) {
      setError(err.message ?? "生成失败");
      setMarkdown("");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const shiftDate = (days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(localDateStr(d));
  };

  const isToday = date === localDateStr();

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {}
  };

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

        {markdown && (
          <button
            onClick={copyMarkdown}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "0.75rem",
              color: "var(--text-tertiary)",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-btn)",
              padding: "5px 12px",
              cursor: "pointer",
              transition: "all var(--transition)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.borderColor = "var(--text-secondary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-tertiary)";
              e.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            复制 Markdown
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-tertiary)", fontSize: "0.85rem" }}>
          生成中...
        </div>
      ) : error ? (
        <div
          style={{
            fontSize: "0.82rem",
            color: "var(--danger)",
            background: "var(--danger-dim)",
            borderRadius: "var(--radius-btn)",
            padding: "12px 16px",
          }}
        >
          {error}
        </div>
      ) : !markdown.trim() || markdown.includes("records: 0") ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-tertiary)" }}>
          <p style={{ fontSize: "0.9rem" }}>这一天没有记录</p>
        </div>
      ) : (
        <article
          className="report-content animate-slide-up"
          dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(markdown) }}
        />
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
