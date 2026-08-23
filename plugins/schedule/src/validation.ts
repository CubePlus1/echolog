import type {
  CreateScheduleItemInput,
  EditScheduleItemInput,
  ScheduleStatus,
} from "./types.js";

const EXPLICIT_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const ITEM_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const STATUSES = new Set<ScheduleStatus>([
  "scheduled",
  "active",
  "done",
  "cancelled",
]);

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function objectBody(body: unknown): ValidationResult<Record<string, unknown>> {
  return body != null && typeof body === "object" && !Array.isArray(body)
    ? { ok: true, value: body as Record<string, unknown> }
    : { ok: false, error: "body must be an object" };
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label = "body"
): string | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  return unknown ? `unknown ${label} field: ${unknown}` : null;
}

function parseNonEmptyString(
  value: unknown,
  field: string,
  maximum: number
): ValidationResult<string> {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    return {
      ok: false,
      error: `${field} must be a non-empty string at most ${maximum} characters`,
    };
  }
  return { ok: true, value: value.trim() };
}

function parseNullableDescription(value: unknown): ValidationResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > 5_000) {
    return {
      ok: false,
      error: "description must be null or a string at most 5000 characters",
    };
  }
  return { ok: true, value };
}

export function parseExplicitInstant(
  value: unknown,
  field: string
): ValidationResult<Date> {
  const match = typeof value === "string" ? EXPLICIT_INSTANT_RE.exec(value) : null;
  if (!match) {
    return {
      ok: false,
      error: `${field} must be an ISO datetime with Z or an explicit numeric offset`,
    };
  }
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match.slice(1).map((part) => part === undefined ? undefined : Number(part));
  const daysInMonth = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  if (
    year! < 1 ||
    month! < 1 || month! > 12 ||
    day! < 1 || day! > daysInMonth ||
    hour! > 23 || minute! > 59 ||
    (second !== undefined && second > 59) ||
    (offsetHour !== undefined && offsetHour > 23) ||
    (offsetMinute !== undefined && offsetMinute > 59)
  ) {
    return { ok: false, error: `${field} must be a valid datetime` };
  }
  const timestamp = Date.parse(value as string);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, error: `${field} must be a valid datetime` };
  }
  return { ok: true, value: new Date(timestamp) };
}

function parseNullableInstant(
  value: unknown,
  field: string
): ValidationResult<Date | null> {
  return value === null
    ? { ok: true, value: null }
    : parseExplicitInstant(value, field);
}

function parseTimezone(value: unknown): ValidationResult<string> {
  const parsed = parseNonEmptyString(value, "timezone", 100);
  if (!parsed.ok) return parsed;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed.value }).format();
  } catch {
    return { ok: false, error: "timezone must be a valid IANA timezone" };
  }
  return parsed;
}

function parsePriority(value: unknown): ValidationResult<number> {
  if (!Number.isInteger(value) || Number(value) < -1_000 || Number(value) > 1_000) {
    return {
      ok: false,
      error: "priority must be an integer from -1000 to 1000",
    };
  }
  return { ok: true, value: Number(value) };
}

function parseExpectedVersion(value: unknown): ValidationResult<number> {
  if (!Number.isInteger(value) || Number(value) < 1) {
    return { ok: false, error: "expectedVersion must be a positive integer" };
  }
  return { ok: true, value: Number(value) };
}

export function validateScheduleInterval(
  start: Date,
  end: Date | null
): string | null {
  return end && end.getTime() <= start.getTime()
    ? "scheduledEndAt must be later than scheduledStartAt"
    : null;
}

export function validateCreateScheduleItem(
  body: unknown
): ValidationResult<CreateScheduleItemInput> {
  const parsedBody = objectBody(body);
  if (!parsedBody.ok) return parsedBody;
  const value = parsedBody.value;
  const unknown = rejectUnknown(value, [
    "title",
    "description",
    "scheduledStartAt",
    "scheduledEndAt",
    "timezone",
    "priority",
    "nextReminderAt",
  ]);
  if (unknown) return { ok: false, error: unknown };

  const title = parseNonEmptyString(value.title, "title", 200);
  if (!title.ok) return title;
  const description = value.description === undefined
    ? { ok: true as const, value: null }
    : parseNullableDescription(value.description);
  if (!description.ok) return description;
  const scheduledStartAt = parseExplicitInstant(
    value.scheduledStartAt,
    "scheduledStartAt"
  );
  if (!scheduledStartAt.ok) return scheduledStartAt;
  const scheduledEndAt = value.scheduledEndAt === undefined
    ? { ok: true as const, value: null }
    : parseNullableInstant(value.scheduledEndAt, "scheduledEndAt");
  if (!scheduledEndAt.ok) return scheduledEndAt;
  const intervalError = validateScheduleInterval(
    scheduledStartAt.value,
    scheduledEndAt.value
  );
  if (intervalError) return { ok: false, error: intervalError };
  const timezone = parseTimezone(value.timezone);
  if (!timezone.ok) return timezone;
  const priority = value.priority === undefined
    ? { ok: true as const, value: 0 }
    : parsePriority(value.priority);
  if (!priority.ok) return priority;
  const nextReminderAt = value.nextReminderAt === undefined
    ? { ok: true as const, value: scheduledStartAt.value }
    : parseNullableInstant(value.nextReminderAt, "nextReminderAt");
  if (!nextReminderAt.ok) return nextReminderAt;

  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      scheduledStartAt: scheduledStartAt.value,
      scheduledEndAt: scheduledEndAt.value,
      timezone: timezone.value,
      priority: priority.value,
      nextReminderAt: nextReminderAt.value,
    },
  };
}

export function validateEditScheduleItem(body: unknown): ValidationResult<{
  expectedVersion: number;
  changes: EditScheduleItemInput;
}> {
  const parsedBody = objectBody(body);
  if (!parsedBody.ok) return parsedBody;
  const value = parsedBody.value;
  const editable = [
    "title",
    "description",
    "scheduledStartAt",
    "scheduledEndAt",
    "timezone",
    "priority",
    "nextReminderAt",
  ] as const;
  const unknown = rejectUnknown(value, ["expectedVersion", ...editable]);
  if (unknown) return { ok: false, error: unknown };
  const expectedVersion = parseExpectedVersion(value.expectedVersion);
  if (!expectedVersion.ok) return expectedVersion;
  if (!editable.some((field) => Object.hasOwn(value, field))) {
    return { ok: false, error: "at least one editable field is required" };
  }

  const changes: EditScheduleItemInput = {};
  if (Object.hasOwn(value, "title")) {
    const result = parseNonEmptyString(value.title, "title", 200);
    if (!result.ok) return result;
    changes.title = result.value;
  }
  if (Object.hasOwn(value, "description")) {
    const result = parseNullableDescription(value.description);
    if (!result.ok) return result;
    changes.description = result.value;
  }
  if (Object.hasOwn(value, "scheduledStartAt")) {
    const result = parseExplicitInstant(value.scheduledStartAt, "scheduledStartAt");
    if (!result.ok) return result;
    changes.scheduledStartAt = result.value;
  }
  if (Object.hasOwn(value, "scheduledEndAt")) {
    const result = parseNullableInstant(value.scheduledEndAt, "scheduledEndAt");
    if (!result.ok) return result;
    changes.scheduledEndAt = result.value;
  }
  if (Object.hasOwn(value, "timezone")) {
    const result = parseTimezone(value.timezone);
    if (!result.ok) return result;
    changes.timezone = result.value;
  }
  if (Object.hasOwn(value, "priority")) {
    const result = parsePriority(value.priority);
    if (!result.ok) return result;
    changes.priority = result.value;
  }
  if (Object.hasOwn(value, "nextReminderAt")) {
    const result = parseNullableInstant(value.nextReminderAt, "nextReminderAt");
    if (!result.ok) return result;
    changes.nextReminderAt = result.value;
  }
  if (changes.scheduledStartAt && Object.hasOwn(changes, "scheduledEndAt")) {
    const intervalError = validateScheduleInterval(
      changes.scheduledStartAt,
      changes.scheduledEndAt ?? null
    );
    if (intervalError) return { ok: false, error: intervalError };
  }
  return { ok: true, value: { expectedVersion: expectedVersion.value, changes } };
}

export function validateExpectedVersionBody(
  body: unknown
): ValidationResult<{ expectedVersion: number }> {
  const parsedBody = objectBody(body);
  if (!parsedBody.ok) return parsedBody;
  const unknown = rejectUnknown(parsedBody.value, ["expectedVersion"]);
  if (unknown) return { ok: false, error: unknown };
  const expectedVersion = parseExpectedVersion(parsedBody.value.expectedVersion);
  return expectedVersion.ok
    ? { ok: true, value: { expectedVersion: expectedVersion.value } }
    : expectedVersion;
}

export function validateSnoozeBody(body: unknown): ValidationResult<{
  expectedVersion: number;
  nextReminderAt: Date;
}> {
  const parsedBody = objectBody(body);
  if (!parsedBody.ok) return parsedBody;
  const unknown = rejectUnknown(parsedBody.value, [
    "expectedVersion",
    "nextReminderAt",
  ]);
  if (unknown) return { ok: false, error: unknown };
  const expectedVersion = parseExpectedVersion(parsedBody.value.expectedVersion);
  if (!expectedVersion.ok) return expectedVersion;
  const nextReminderAt = parseExplicitInstant(
    parsedBody.value.nextReminderAt,
    "nextReminderAt"
  );
  if (!nextReminderAt.ok) return nextReminderAt;
  return {
    ok: true,
    value: {
      expectedVersion: expectedVersion.value,
      nextReminderAt: nextReminderAt.value,
    },
  };
}

export function validateItemId(id: string): string | null {
  return ITEM_ID_RE.test(id) ? null : "schedule item id is invalid";
}

function queryObject(query: unknown): Record<string, unknown> {
  return query && typeof query === "object" && !Array.isArray(query)
    ? query as Record<string, unknown>
    : {};
}

export function validateListQuery(query: unknown): ValidationResult<{
  from?: Date;
  to?: Date;
  statuses?: ScheduleStatus[];
}> {
  const value = queryObject(query);
  const unknown = rejectUnknown(value, ["from", "to", "status"], "query");
  if (unknown) return { ok: false, error: unknown };
  const result: { from?: Date; to?: Date; statuses?: ScheduleStatus[] } = {};
  if (value.from !== undefined) {
    const from = parseExplicitInstant(value.from, "from");
    if (!from.ok) return from;
    result.from = from.value;
  }
  if (value.to !== undefined) {
    const to = parseExplicitInstant(value.to, "to");
    if (!to.ok) return to;
    result.to = to.value;
  }
  if (result.from && result.to && result.from >= result.to) {
    return { ok: false, error: "to must be later than from" };
  }
  if (value.status !== undefined) {
    if (typeof value.status !== "string" || !value.status) {
      return { ok: false, error: "status must be a comma-separated status list" };
    }
    const statuses = value.status.split(",") as ScheduleStatus[];
    if (
      statuses.length > STATUSES.size ||
      new Set(statuses).size !== statuses.length ||
      statuses.some((status) => !STATUSES.has(status))
    ) {
      return {
        ok: false,
        error: "status values must be scheduled, active, done, or cancelled",
      };
    }
    result.statuses = statuses;
  }
  return { ok: true, value: result };
}

export function validateReminderQuery(query: unknown): ValidationResult<{
  itemId?: string;
  limit: number;
}> {
  const value = queryObject(query);
  const unknown = rejectUnknown(value, ["itemId", "limit"], "query");
  if (unknown) return { ok: false, error: unknown };
  if (value.itemId !== undefined) {
    if (typeof value.itemId !== "string" || validateItemId(value.itemId)) {
      return { ok: false, error: "itemId is invalid" };
    }
  }
  const limit = value.limit === undefined ? 100 : Number(value.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return { ok: false, error: "limit must be an integer from 1 to 500" };
  }
  return {
    ok: true,
    value: {
      ...(typeof value.itemId === "string" ? { itemId: value.itemId } : {}),
      limit,
    },
  };
}
