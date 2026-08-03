import { loadConfig } from "../core/config.js";

const CONNECTION_ERROR = "无法连接到 EchoLog server。请先运行: el daemon start";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ConnectionError extends Error {
  constructor() {
    super(CONNECTION_ERROR);
    this.name = "ConnectionError";
  }
}

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
    const config = loadConfig();
    const headers: Record<string, string> = { ...options?.headers as any };
    if (options?.body) headers["Content-Type"] = "application/json";
    if (config.server.apiKey) headers["x-api-key"] = config.server.apiKey;
    res = await fetch(url, { ...options, headers });
  } catch {
    throw new ConnectionError();
  }

  if (!res.ok) {
    const body = await res.clone().json().catch(async () => {
      const text = await res.text().catch(() => "");
      return text ? { error: text } : {};
    });
    const msg = (body as any).error ?? (body as any).message ?? res.statusText;
    throw new ApiError(res.status, body, `API error ${res.status}: ${msg}`);
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
