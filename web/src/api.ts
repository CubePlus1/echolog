const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? res.statusText);
  }
  return res.json();
}

export interface Record {
  id: string;
  title: string;
  type: "learning" | "project" | "task";
  tags: string[];
  project: string | null;
  startAt: string;
  endAt: string | null;
  status: "running" | "paused" | "done" | "cancelled";
  durationSeconds: number;
  result: string | null;
  source: string;
  lastResumedAt?: string | null;
  liveDurationSeconds?: number;
}

export interface TodaySummary {
  totalSeconds: number;
  recordCount: number;
  byType: { learning: number; project: number; task: number };
  active: Record[];
}

export const api = {
  getActive: () => request<Record[]>("/records/active"),

  getTodaySummary: () => request<TodaySummary>("/summary/today"),

  startRecord: (data: {
    title: string;
    type?: string;
    tags?: string[];
    project?: string;
  }) =>
    request<Record>("/records", {
      method: "POST",
      body: JSON.stringify({ ...data, source: "web" }),
    }),

  stopRecord: (id: string, result?: string) =>
    request<Record>(`/records/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "stop", result }),
    }),

  pauseRecord: (id: string) =>
    request<Record>(`/records/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "pause" }),
    }),

  resumeRecord: (id: string) =>
    request<Record>(`/records/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "resume" }),
    }),

  cancelRecord: (id: string) =>
    request<Record>(`/records/${id}`, { method: "DELETE" }),

  getTodayRecords: () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return request<Record[]>(`/records?date=${today}`);
  },
};
