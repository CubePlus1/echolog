import { parseOffsetAwareIso } from "./http-validation.js";

const DELIVERY_CURSOR_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export interface DeliveryCursor {
  surfacedAt: Date;
  id: string;
}

export function encodeDeliveryCursor(value: {
  surfacedAt: Date;
  id: string;
}): string {
  if (
    !Number.isFinite(value.surfacedAt.getTime()) ||
    !DELIVERY_CURSOR_ID_RE.test(value.id)
  ) {
    throw new TypeError("delivery cursor is invalid");
  }
  return Buffer.from(JSON.stringify({
    surfacedAt: value.surfacedAt.toISOString(),
    id: value.id,
  })).toString("base64url");
}

export function decodeDeliveryCursor(value: string): DeliveryCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return null;
    }
    const record = decoded as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      typeof record.surfacedAt !== "string" ||
      typeof record.id !== "string" ||
      !DELIVERY_CURSOR_ID_RE.test(record.id)
    ) {
      return null;
    }
    const surfacedAt = parseOffsetAwareIso(record.surfacedAt);
    return surfacedAt ? { surfacedAt, id: record.id } : null;
  } catch {
    return null;
  }
}
