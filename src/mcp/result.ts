import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, ConnectionError } from "../client/api.js";

export type StructuredResult = Record<string, unknown>;

export function expectObject(value: unknown): StructuredResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("EchoLog API returned a non-object response");
  }
  return value as StructuredResult;
}

export function wrapRecords(value: unknown): StructuredResult {
  if (!Array.isArray(value)) {
    throw new Error("EchoLog API returned a non-array records response");
  }
  return { records: value };
}

function errorContent(error: unknown): StructuredResult {
  if (error instanceof ApiError) {
    const body = typeof error.body === "object" && error.body !== null && !Array.isArray(error.body)
      ? error.body as StructuredResult
      : { body: error.body };
    return {
      ...body,
      error: typeof body.error === "string" ? body.error : error.message,
      status: error.status,
    };
  }
  if (error instanceof ConnectionError) {
    return { error: error.message, code: "CONNECTION_ERROR" };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

function textContent(value: StructuredResult): CallToolResult["content"] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

export async function executeTool(
  operation: () => Promise<unknown>,
  normalize: (value: unknown) => StructuredResult = expectObject
): Promise<CallToolResult> {
  try {
    const structuredContent = normalize(await operation());
    return {
      content: textContent(structuredContent),
      structuredContent,
    };
  } catch (error) {
    const errorResult = errorContent(error);
    return {
      content: textContent(errorResult),
      isError: true,
    };
  }
}
