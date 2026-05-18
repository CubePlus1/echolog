import type { Record as TaskRecord } from "../api";
import { api } from "../api";
import Timer from "./Timer";

const typeColors: { [k: string]: string } = {
  learning: "bg-emerald-600",
  project: "bg-blue-600",
  task: "bg-amber-600",
};

const typeLabels: { [k: string]: string } = {
  learning: "学习",
  project: "项目",
  task: "任务",
};

export default function TaskCard({
  record,
  onUpdate,
}: {
  record: TaskRecord;
  onUpdate: () => void;
}) {
  const isRunning = record.status === "running";
  const isPaused = record.status === "paused";

  const handlePauseResume = async () => {
    if (isRunning) await api.pauseRecord(record.id);
    else if (isPaused) await api.resumeRecord(record.id);
    onUpdate();
  };

  const handleStop = async () => {
    const result = window.prompt("结果总结（可留空）:");
    await api.stopRecord(record.id, result ?? undefined);
    onUpdate();
  };

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`${typeColors[record.type] ?? "bg-gray-600"} text-xs px-2 py-0.5 rounded-full text-white`}
            >
              {typeLabels[record.type] ?? record.type}
            </span>
            {record.project && (
              <span className="text-xs text-slate-400">
                [{record.project}]
              </span>
            )}
            <span
              className={`w-2 h-2 rounded-full ${isRunning ? "bg-green-400 animate-pulse" : "bg-yellow-400"}`}
            />
          </div>
          <h3 className="text-lg font-medium text-white">{record.title}</h3>
        </div>
        <Timer
          startAt={record.startAt}
          paused={isPaused}
          baseSeconds={record.durationSeconds}
        />
      </div>

      {record.tags.length > 0 && (
        <div className="flex gap-1 mb-3">
          {record.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handlePauseResume}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isRunning
              ? "bg-yellow-600 hover:bg-yellow-500 text-white"
              : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {isRunning ? "⏸ 暂停" : "▶ 恢复"}
        </button>
        <button
          onClick={handleStop}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
        >
          ⏹ 停止
        </button>
      </div>
    </div>
  );
}
