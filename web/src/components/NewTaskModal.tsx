import { useState } from "react";
import { api } from "../api";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.startRecord({
        title: title.trim(),
        type,
        tags: tags
          ? tags.split(",").map((t) => t.trim()).filter(Boolean)
          : undefined,
        project: project.trim() || undefined,
      });
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-slate-800 rounded-2xl p-6 w-full max-w-md border border-slate-700 shadow-2xl"
      >
        <h2 className="text-xl font-semibold text-white mb-4">开始新任务</h2>

        <label className="block mb-3">
          <span className="text-sm text-slate-400">标题</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            placeholder="学习 Java HashMap"
            autoFocus
          />
        </label>

        <label className="block mb-3">
          <span className="text-sm text-slate-400">类型</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="learning">学习</option>
            <option value="project">项目</option>
            <option value="task">任务</option>
          </select>
        </label>

        <label className="block mb-3">
          <span className="text-sm text-slate-400">标签（逗号分隔）</span>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            placeholder="java, 学习"
          />
        </label>

        <label className="block mb-4">
          <span className="text-sm text-slate-400">项目（可选）</span>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            placeholder="eoove"
          />
        </label>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!title.trim() || submitting}
            className="px-6 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 transition-colors"
          >
            {submitting ? "启动中..." : "开始"}
          </button>
        </div>
      </form>
    </div>
  );
}
