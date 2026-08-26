import type {
  PluginHttpRequest,
  PluginHttpResponse,
  PluginRoute,
} from "@echolog/plugin-sdk";
import {
  decodeInspirationCursor,
  InspirationStoreError,
  type InspirationPage,
  type InspirationStoreListFilter,
} from "./store.js";
import { parseOffsetAwareIso } from "./http-validation.js";
import type {
  CreateInspirationInput,
  Inspiration,
  InspirationStatus,
  UpdateInspirationInput,
} from "./types.js";

const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const MAX_CONTENT_LENGTH = 10_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_PROJECT_LENGTH = 100;

export interface InspirationCaptureStore {
  create(input: CreateInspirationInput): Promise<Inspiration>;
  get(id: string): Promise<Inspiration | null>;
  list(filter: InspirationStoreListFilter): Promise<InspirationPage>;
  update(id: string, input: UpdateInspirationInput): Promise<Inspiration>;
  archive(id: string, expectedVersion: number): Promise<Inspiration>;
  restore(
    id: string,
    expectedVersion: number,
    status: Exclude<InspirationStatus, "archived">
  ): Promise<Inspiration>;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function response(statusCode: number, body: unknown): PluginHttpResponse {
  return { statusCode, body };
}

function validationError(error: string): PluginHttpResponse {
  return response(400, {
    error,
    code: "INSPIRATION_VALIDATION_ERROR",
  });
}

function storeError(error: unknown): PluginHttpResponse {
  if (!(error instanceof InspirationStoreError)) throw error;
  return response(error.statusCode, {
    error: error.message,
    code: error.code,
    ...(error.currentVersion === undefined
      ? {}
      : { currentVersion: error.currentVersion }),
  });
}

function objectBody(body: unknown): ValidationResult<Record<string, unknown>> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "body must be an object" };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[]
): string | null {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  return unknown ? `unknown field: ${unknown}` : null;
}

function normalizeContent(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: "content must be a string" };
  }
  const content = value.trim();
  if (content.length < 1 || content.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      error: `content must contain 1 to ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  return { ok: true, value: content };
}

function normalizeTags(value: unknown): ValidationResult<string[]> {
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    return {
      ok: false,
      error: `tags must be an array with at most ${MAX_TAGS} entries`,
    };
  }
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { ok: false, error: "each tag must be a string" };
    }
    const tag = item.trim().toLowerCase();
    if (tag.length < 1 || tag.length > MAX_TAG_LENGTH) {
      return {
        ok: false,
        error: `each tag must contain 1 to ${MAX_TAG_LENGTH} characters`,
      };
    }
    if (!normalized.includes(tag)) normalized.push(tag);
  }
  return { ok: true, value: normalized.sort() };
}

function normalizeProject(value: unknown): ValidationResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "project must be a string or null" };
  }
  const project = value.trim();
  if (project.length > MAX_PROJECT_LENGTH) {
    return {
      ok: false,
      error: `project must contain at most ${MAX_PROJECT_LENGTH} characters`,
    };
  }
  return { ok: true, value: project || null };
}

function activeStatus(
  value: unknown,
  field = "status"
): ValidationResult<"inbox" | "kept"> {
  return value === "inbox" || value === "kept"
    ? { ok: true, value }
    : { ok: false, error: `${field} must be inbox or kept` };
}

function expectedVersion(value: unknown): ValidationResult<number> {
  return Number.isInteger(value) && Number(value) >= 1
    ? { ok: true, value: Number(value) }
    : { ok: false, error: "expectedVersion must be a positive integer" };
}

function validateCreate(body: unknown): ValidationResult<CreateInspirationInput> {
  const object = objectBody(body);
  if (!object.ok) return object;
  const unknown = rejectUnknownKeys(object.value, [
    "content",
    "tags",
    "project",
    "status",
  ]);
  if (unknown) return { ok: false, error: unknown };
  const content = normalizeContent(object.value.content);
  if (!content.ok) return content;
  const tags = normalizeTags(object.value.tags ?? []);
  if (!tags.ok) return tags;
  const project = normalizeProject(object.value.project ?? null);
  if (!project.ok) return project;
  const status = activeStatus(object.value.status ?? "inbox");
  if (!status.ok) return status;
  return {
    ok: true,
    value: {
      content: content.value,
      tags: tags.value,
      project: project.value,
      status: status.value,
    },
  };
}

function validateUpdate(body: unknown): ValidationResult<UpdateInspirationInput> {
  const object = objectBody(body);
  if (!object.ok) return object;
  const unknown = rejectUnknownKeys(object.value, [
    "expectedVersion",
    "content",
    "tags",
    "project",
    "status",
  ]);
  if (unknown) return { ok: false, error: unknown };
  const version = expectedVersion(object.value.expectedVersion);
  if (!version.ok) return version;
  const mutable = ["content", "tags", "project", "status"]
    .filter((key) => Object.hasOwn(object.value, key));
  if (!mutable.length) {
    return { ok: false, error: "at least one mutable field is required" };
  }
  const result: UpdateInspirationInput = { expectedVersion: version.value };
  if (Object.hasOwn(object.value, "content")) {
    const content = normalizeContent(object.value.content);
    if (!content.ok) return content;
    result.content = content.value;
  }
  if (Object.hasOwn(object.value, "tags")) {
    const tags = normalizeTags(object.value.tags);
    if (!tags.ok) return tags;
    result.tags = tags.value;
  }
  if (Object.hasOwn(object.value, "project")) {
    const project = normalizeProject(object.value.project);
    if (!project.ok) return project;
    result.project = project.value;
  }
  if (Object.hasOwn(object.value, "status")) {
    const status = activeStatus(object.value.status);
    if (!status.ok) return status;
    result.status = status.value;
  }
  return { ok: true, value: result };
}

function validateVersionBody(body: unknown): ValidationResult<number> {
  const object = objectBody(body);
  if (!object.ok) return object;
  const unknown = rejectUnknownKeys(object.value, ["expectedVersion"]);
  if (unknown) return { ok: false, error: unknown };
  return expectedVersion(object.value.expectedVersion);
}

function validateRestore(body: unknown): ValidationResult<{
  expectedVersion: number;
  status: "inbox" | "kept";
}> {
  const object = objectBody(body);
  if (!object.ok) return object;
  const unknown = rejectUnknownKeys(object.value, ["expectedVersion", "status"]);
  if (unknown) return { ok: false, error: unknown };
  const version = expectedVersion(object.value.expectedVersion);
  if (!version.ok) return version;
  const status = activeStatus(object.value.status ?? "inbox");
  if (!status.ok) return status;
  return {
    ok: true,
    value: { expectedVersion: version.value, status: status.value },
  };
}

function queryObject(query: unknown): ValidationResult<Record<string, unknown>> {
  if (query == null) return { ok: true, value: {} };
  if (typeof query !== "object" || Array.isArray(query)) {
    return { ok: false, error: "query must be an object" };
  }
  const value = query as Record<string, unknown>;
  const unknown = rejectUnknownKeys(value, [
    "text",
    "tag",
    "project",
    "status",
    "includeArchived",
    "createdBefore",
    "createdAfter",
    "cursor",
    "limit",
  ]);
  return unknown ? { ok: false, error: unknown } : { ok: true, value };
}

function singleQueryString(
  value: unknown,
  name: string
): ValidationResult<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return typeof value === "string"
    ? { ok: true, value }
    : { ok: false, error: `${name} must be specified once` };
}

function repeatedQueryStrings(
  value: unknown,
  name: string
): ValidationResult<string[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.some((item) => typeof item !== "string")) {
    return { ok: false, error: `${name} must contain strings` };
  }
  return { ok: true, value: values as string[] };
}

function isoDate(value: string, name: string): ValidationResult<Date> {
  const date = parseOffsetAwareIso(value);
  return date
    ? { ok: true, value: date }
    : {
        ok: false,
        error: `${name} must be an ISO 8601 timestamp with Z or ±HH:mm offset`,
      };
}

function validateList(query: unknown): ValidationResult<InspirationStoreListFilter> {
  const object = queryObject(query);
  if (!object.ok) return object;
  const text = singleQueryString(object.value.text, "text");
  if (!text.ok) return text;
  if (text.value !== undefined && (text.value.trim().length < 1 || text.value.length > 500)) {
    return { ok: false, error: "text must contain 1 to 500 characters" };
  }
  const project = singleQueryString(object.value.project, "project");
  if (!project.ok) return project;
  if (project.value !== undefined && (project.value.trim().length < 1 || project.value.length > MAX_PROJECT_LENGTH)) {
    return { ok: false, error: `project must contain 1 to ${MAX_PROJECT_LENGTH} characters` };
  }
  const rawTags = repeatedQueryStrings(object.value.tag, "tag");
  if (!rawTags.ok) return rawTags;
  const tags = normalizeTags(rawTags.value ?? []);
  if (!tags.ok) return tags;
  const rawStatuses = repeatedQueryStrings(object.value.status, "status");
  if (!rawStatuses.ok) return rawStatuses;
  const statuses: InspirationStatus[] = [];
  for (const status of rawStatuses.value ?? []) {
    if (status !== "inbox" && status !== "kept" && status !== "archived") {
      return { ok: false, error: "status must be inbox, kept, or archived" };
    }
    if (!statuses.includes(status)) statuses.push(status);
  }
  const rawIncludeArchived = singleQueryString(
    object.value.includeArchived,
    "includeArchived"
  );
  if (!rawIncludeArchived.ok) return rawIncludeArchived;
  if (
    rawIncludeArchived.value !== undefined &&
    rawIncludeArchived.value !== "true" &&
    rawIncludeArchived.value !== "false"
  ) {
    return { ok: false, error: "includeArchived must be true or false" };
  }
  const rawLimit = singleQueryString(object.value.limit, "limit");
  if (!rawLimit.ok) return rawLimit;
  const limit = rawLimit.value === undefined ? 50 : Number(rawLimit.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, error: "limit must be an integer from 1 to 100" };
  }
  const rawBefore = singleQueryString(object.value.createdBefore, "createdBefore");
  if (!rawBefore.ok) return rawBefore;
  const rawAfter = singleQueryString(object.value.createdAfter, "createdAfter");
  if (!rawAfter.ok) return rawAfter;
  const rawCursor = singleQueryString(object.value.cursor, "cursor");
  if (!rawCursor.ok) return rawCursor;
  let before: Date | undefined;
  let beforeId: string | undefined;
  if (rawCursor.value !== undefined) {
    const cursor = decodeInspirationCursor(rawCursor.value);
    if (!cursor) return { ok: false, error: "cursor is invalid" };
    before = cursor.before;
    beforeId = cursor.beforeId;
  } else if (rawBefore.value !== undefined) {
    const parsed = isoDate(rawBefore.value, "createdBefore");
    if (!parsed.ok) return parsed;
    before = parsed.value;
  }
  let after: Date | undefined;
  if (rawAfter.value !== undefined) {
    const parsed = isoDate(rawAfter.value, "createdAfter");
    if (!parsed.ok) return parsed;
    after = parsed.value;
  }
  if (before && after && before <= after) {
    return { ok: false, error: "createdBefore must be later than createdAfter" };
  }
  return {
    ok: true,
    value: {
      ...(text.value === undefined ? {} : { text: text.value.trim() }),
      ...(tags.value.length ? { tags: tags.value } : {}),
      ...(project.value === undefined ? {} : { project: project.value.trim() }),
      ...(statuses.length ? { statuses } : {}),
      includeArchived: rawIncludeArchived.value === "true",
      limit,
      ...(before ? { before } : {}),
      ...(beforeId ? { beforeId } : {}),
      ...(after ? { after } : {}),
    },
  };
}

function validId(id: string): PluginHttpResponse | null {
  return ID_RE.test(id)
    ? null
    : validationError("inspiration id is invalid");
}

export function createInspirationRoutes(
  store: () => InspirationCaptureStore
): PluginRoute[] {
  return [
    {
      method: "POST",
      path: "/api/plugins/inspiration/inspirations",
      async handler(request: PluginHttpRequest) {
        const validated = validateCreate(request.body);
        if (!validated.ok) return validationError(validated.error);
        return response(201, await store().create(validated.value));
      },
    },
    {
      method: "GET",
      path: "/api/plugins/inspiration/inspirations",
      async handler(request: PluginHttpRequest) {
        const validated = validateList(request.query);
        if (!validated.ok) return validationError(validated.error);
        return store().list(validated.value);
      },
    },
    {
      method: "GET",
      path: "/api/plugins/inspiration/inspirations/:id",
      async handler(request: PluginHttpRequest) {
        const invalid = validId(request.params.id);
        if (invalid) return invalid;
        const row = await store().get(request.params.id);
        return row ?? response(404, {
          error: `Inspiration ${request.params.id} not found`,
          code: "INSPIRATION_NOT_FOUND",
        });
      },
    },
    {
      method: "PATCH",
      path: "/api/plugins/inspiration/inspirations/:id",
      async handler(request: PluginHttpRequest) {
        const invalid = validId(request.params.id);
        if (invalid) return invalid;
        const validated = validateUpdate(request.body);
        if (!validated.ok) return validationError(validated.error);
        try {
          return await store().update(request.params.id, validated.value);
        } catch (error) {
          return storeError(error);
        }
      },
    },
    {
      method: "POST",
      path: "/api/plugins/inspiration/inspirations/:id/archive",
      async handler(request: PluginHttpRequest) {
        const invalid = validId(request.params.id);
        if (invalid) return invalid;
        const validated = validateVersionBody(request.body);
        if (!validated.ok) return validationError(validated.error);
        try {
          return await store().archive(request.params.id, validated.value);
        } catch (error) {
          return storeError(error);
        }
      },
    },
    {
      method: "POST",
      path: "/api/plugins/inspiration/inspirations/:id/restore",
      async handler(request: PluginHttpRequest) {
        const invalid = validId(request.params.id);
        if (invalid) return invalid;
        const validated = validateRestore(request.body);
        if (!validated.ok) return validationError(validated.error);
        try {
          return await store().restore(
            request.params.id,
            validated.value.expectedVersion,
            validated.value.status
          );
        } catch (error) {
          return storeError(error);
        }
      },
    },
  ];
}
