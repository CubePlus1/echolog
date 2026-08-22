import type { ProviderProfile } from "./provider-profiles.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CONTENT_CHARS = 32_000;

export const SCREEN_UNDERSTANDING_SYSTEM_PROMPT = [
  "你是 EchoLog 的私有屏幕理解助手。",
  "只分析提供的截图，并概括用户当前正在做什么。",
  "不要抄录密码、访问令牌、私信正文或其他秘密信息。",
  "如果截图中有敏感内容，将 sensitive 设为 true，并用概括性的中文描述。",
  "必须使用简体中文输出所有字段值；不要输出英文句子、英文解释或英文应用名。",
  "如果应用名称没有合适的中文名称，使用中文通用类别，例如“邮箱”“浏览器”“代码编辑器”或“即时通讯”。",
  "只返回一个 JSON 对象，并且只能包含以下固定键名：",
  "summary（字符串，最多 500 个字符）、activity（字符串，最多 200 个字符）、confidence（0 到 1 的数字）、sensitive（布尔值）、apps（最多 12 个简短中文字符串的数组）。",
].join(" ");

export type VisionProviderErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REQUEST_REJECTED"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_CANCELLED";

export class VisionProviderError extends Error {
  constructor(
    public readonly code: VisionProviderErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "VisionProviderError";
  }
}

export interface VisionCompletion {
  content: string;
  latencyMs: number;
  costMicros: number | null;
}

export interface VisionProviderClient {
  complete(
    profile: ProviderProfile,
    apiKey: string,
    png: Buffer,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<VisionCompletion>;
}

export function buildVisionRequestPayload(
  profile: ProviderProfile,
  png: Buffer
): Record<string, unknown> {
  return {
    model: profile.model,
    temperature: 0,
    max_tokens: 500,
    messages: [
      {
        role: "system",
        content: SCREEN_UNDERSTANDING_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请用简体中文简洁描述用户现在正在做什么，并返回要求的 JSON 对象。不要使用英文。",
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${png.toString("base64")}`,
              detail: "low",
            },
          },
        ],
      },
    ],
  };
}

function abortError(): VisionProviderError {
  return new VisionProviderError(
    "PROVIDER_CANCELLED",
    "Screen understanding request was cancelled",
    499,
    false
  );
}

function parseJsonBody(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider response is too large",
      502,
      false
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider returned invalid JSON",
      502,
      false
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider returned an invalid response",
      502,
      false
    );
  }
  return value as Record<string, unknown>;
}

function responseContent(value: Record<string, unknown>): string {
  const choices = value.choices;
  if (!Array.isArray(choices) || choices.length < 1) {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider response has no choices",
      502,
      false
    );
  }
  const first = choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider response has an invalid choice",
      502,
      false
    );
  }
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new VisionProviderError(
      "PROVIDER_RESPONSE_INVALID",
      "Vision provider response has no message",
      502,
      false
    );
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
      throw new VisionProviderError(
        "PROVIDER_RESPONSE_INVALID",
        "Vision provider response content is invalid",
        502,
        false
      );
    }
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is Record<string, unknown> =>
        Boolean(part && typeof part === "object" && !Array.isArray(part))
      )
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n");
    if (text.length > 0 && text.length <= MAX_CONTENT_CHARS) return text;
  }
  throw new VisionProviderError(
    "PROVIDER_RESPONSE_INVALID",
    "Vision provider response content is invalid",
    502,
    false
  );
}

function responseCostMicros(value: Record<string, unknown>): number | null {
  const usage = value.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const object = usage as Record<string, unknown>;
  for (const key of ["cost_micros", "costMicros"]) {
    const candidate = object[key];
    if (Number.isInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 2_000_000_000) {
      return Number(candidate);
    }
  }
  return null;
}

function endpointFor(profile: ProviderProfile): string {
  return `${profile.baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export class OpenAICompatibleVisionClient implements VisionProviderClient {
  async complete(
    profile: ProviderProfile,
    apiKey: string,
    png: Buffer,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<VisionCompletion> {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(endpointFor(profile), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildVisionRequestPayload(profile, png)),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new VisionProviderError(
            "PROVIDER_AUTH",
            "Vision provider rejected the configured API key",
            502,
            false
          );
        }
        if (response.status === 429) {
          throw new VisionProviderError(
            "PROVIDER_RATE_LIMITED",
            "Vision provider rate limit reached",
            429,
            true
          );
        }
        throw new VisionProviderError(
          response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_REJECTED",
          response.status >= 500
            ? "Vision provider is temporarily unavailable"
            : `Vision provider rejected the request (${response.status})`,
          response.status >= 500 ? 502 : 400,
          response.status >= 500
        );
      }
      const value = parseJsonBody(text);
      return {
        content: responseContent(value),
        latencyMs: Math.max(0, Date.now() - startedAt),
        costMicros: responseCostMicros(value),
      };
    } catch (error) {
      if (error instanceof VisionProviderError) throw error;
      if (signal?.aborted) throw abortError();
      if (timedOut) {
        throw new VisionProviderError(
          "PROVIDER_TIMEOUT",
          "Vision provider request timed out",
          504,
          true
        );
      }
      throw new VisionProviderError(
        "PROVIDER_UNAVAILABLE",
        "Vision provider could not be reached",
        502,
        true
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
