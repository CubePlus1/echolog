import { loadConfig } from "../core/config.js";

function baseUrl(): string {
  const config = loadConfig();
  return `http://localhost:${config.server.port}`;
}

export async function api<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    console.error(
      "无法连接到 ClawLog server。请先运行: cl daemon start"
    );
    process.exit(1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as any).error ?? (body as any).message ?? res.statusText;
    throw new Error(`API error ${res.status}: ${msg}`);
  }
  return res.json() as T;
}

export function post<T = any>(path: string, body?: unknown): Promise<T> {
  return api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
}

export function patch<T = any>(path: string, body: unknown): Promise<T> {
  return api(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function del<T = any>(path: string): Promise<T> {
  return api(path, { method: "DELETE" });
}
