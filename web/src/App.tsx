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

  return (
    <div className="min-h-screen p-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">EchoLog</h1>
          <p className="text-sm text-slate-400">
            {new Date().toLocaleDateString("zh-CN", {
              year: "numeric",
              month: "long",
              day: "numeric",
              weekday: "long",
            })}
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-5 py-2.5 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-600/20"
        >
          + 开始新任务
        </button>
      </header>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 mb-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {summary && <TodaySummary summary={summary} />}

      <div className="mt-6 space-y-3">
        {active.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p className="text-lg mb-2">没有进行中的任务</p>
            <p className="text-sm">
              点击「开始新任务」或使用{" "}
              <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs">
                el start "标题"
              </code>
            </p>
          </div>
        ) : (
          active.map((record) => (
            <TaskCard key={record.id} record={record} onUpdate={refresh} />
          ))
        )}
      </div>

      {showNew && (
        <NewTaskModal
          onClose={() => setShowNew(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
