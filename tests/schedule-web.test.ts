import assert from "node:assert/strict";
import test from "node:test";
import { createPluginWebHost } from "../web/plugin-host.js";
import {
  activate,
  scheduleWebTest,
} from "../plugins/schedule/web/index.js";

const NOW = new Date("2026-08-24T00:00:00.000Z");

type ItemOverrides = Partial<{
  id: string;
  title: string;
  description: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  timezone: string;
  priority: number;
  status: string;
  nextReminderAt: string | null;
  confirmedStartAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  awaitingConfirmation: boolean;
}>;

function item(overrides: ItemOverrides = {}) {
  return {
    id: "schedule-1",
    title: "例会",
    description: null,
    scheduledStartAt: "2026-08-24T01:00:00.000Z",
    scheduledEndAt: null,
    timezone: "Asia/Shanghai",
    priority: 0,
    status: "scheduled",
    nextReminderAt: "2026-08-24T01:00:00.000Z",
    confirmedStartAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    awaitingConfirmation: false,
    ...overrides,
  };
}

function escapeText(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: unknown) {
  return escapeText(value).replaceAll("'", "&#39;");
}

function renderContext(scheduleItems: ReturnType<typeof item>[]) {
  return {
    data: { scheduleItems },
    esc: escapeText,
    escA: escapeAttribute,
    fmtDur: String,
  };
}

function styleRoot() {
  const links: Array<Record<string, any>> = [];
  const head = {
    appendChild(link: Record<string, any>) {
      links.push(link);
    },
  };
  const documentRef = {
    head,
    activeElement: null as null | {
      tagName: string;
      closest(selector: string): unknown;
    },
    createElement(tagName: string) {
      const link: Record<string, any> = {
        tagName,
        dataset: {},
        remove() {
          const index = links.indexOf(link);
          if (index >= 0) links.splice(index, 1);
        },
      };
      return link;
    },
  };
  return { root: { ownerDocument: documentRef }, links, documentRef };
}

function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function sectionFor(html: string, dateKey: string) {
  const escaped = dateKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<section[^>]+data-date="${escaped}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? "";
}

test("Schedule month, week, and day ranges group one item source in each item's timezone", () => {
  const shanghai = item({
    id: "shanghai",
    title: "上海早会",
    scheduledStartAt: "2026-08-23T23:30:00.000Z",
    timezone: "Asia/Shanghai",
  });
  const losAngeles = item({
    id: "los-angeles",
    title: "洛杉矶回顾",
    scheduledStartAt: "2026-08-23T23:30:00.000Z",
    timezone: "America/Los_Angeles",
  });
  const spanning = item({
    id: "spanning",
    title: "跨日发布",
    scheduledStartAt: "2026-08-24T15:30:00.000Z",
    scheduledEndAt: "2026-08-25T16:30:00.000Z",
    timezone: "Asia/Shanghai",
  });
  const items = [shanghai, losAngeles, spanning];

  assert.deepEqual(scheduleWebTest.rangeForView("month", "2026-08-24"), {
    from: "2026-07-27",
    to: "2026-09-07",
    keys: Array.from({ length: 42 }, (_, index) => scheduleWebTest.addDays("2026-07-27", index)),
  });
  assert.deepEqual(scheduleWebTest.rangeForView("week", "2026-08-24").keys, [
    "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
    "2026-08-28", "2026-08-29", "2026-08-30",
  ]);
  assert.deepEqual(scheduleWebTest.rangeForView("day", "2026-08-24").keys, ["2026-08-24"]);
  assert.equal(scheduleWebTest.dateKeyInTimezone(shanghai.scheduledStartAt, shanghai.timezone), "2026-08-24");
  assert.equal(scheduleWebTest.dateKeyInTimezone(losAngeles.scheduledStartAt, losAngeles.timezone), "2026-08-23");

  const month = scheduleWebTest.groupItems(items, "month", "2026-08-24");
  assert.deepEqual(month.groups.get("2026-08-23").map((entry: any) => entry.id), ["los-angeles"]);
  assert.deepEqual(month.groups.get("2026-08-24").map((entry: any) => entry.id), ["shanghai", "spanning"]);
  assert.deepEqual(month.groups.get("2026-08-25").map((entry: any) => entry.id), ["spanning"]);
  assert.deepEqual(month.groups.get("2026-08-26").map((entry: any) => entry.id), ["spanning"]);

  const week = scheduleWebTest.groupItems(items, "week", "2026-08-24");
  assert.equal([...week.groups.values()].flat().some((entry: any) => entry.id === "los-angeles"), false);
  const day = scheduleWebTest.groupItems(items, "day", "2026-08-24");
  assert.deepEqual(day.groups.get("2026-08-24").map((entry: any) => entry.id), ["shanghai", "spanning"]);
});

test("Schedule loads one canonical range and renders month/week/day placement with derived awaiting state", async () => {
  const fixtures = [
    item({
      id: "shanghai",
      title: "上海早会",
      scheduledStartAt: "2026-08-23T23:30:00.000Z",
      timezone: "Asia/Shanghai",
      awaitingConfirmation: false,
    }),
    item({
      id: "los-angeles",
      title: "洛杉矶回顾",
      scheduledStartAt: "2026-08-23T23:30:00.000Z",
      timezone: "America/Los_Angeles",
    }),
  ];
  const calls: Array<{ path: string; options?: unknown }> = [];
  const { root } = styleRoot();
  const contribution = await activate({
    root,
    now: () => NOW,
    api: async (path: string, options?: unknown) => {
      calls.push({ path, options });
      return fixtures;
    },
  });
  const data = await contribution.load();
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].path, "http://echolog.local");
  assert.equal(request.pathname, "/plugins/schedule/items");
  assert.deepEqual(Object.fromEntries(request.searchParams), {
    from: "2026-07-25T00:00:00.000Z",
    to: "2026-09-09T00:00:00.000Z",
  });
  assert.deepEqual(contribution.faces(), [
    { type: "schedule-overview" },
    { type: "schedule-month" },
    { type: "schedule-week" },
    { type: "schedule-day" },
  ]);

  const context = renderContext(data.scheduleItems);
  const overview = contribution.renderFace({ type: "schedule-overview" }, context);
  assert.match(overview, /schedule-awaiting/);
  assert.match(overview, /待确认/);
  assert.equal(overview.includes("data-act=\"schedule-ignore\""), false);

  const month = contribution.renderFace({ type: "schedule-month" }, context);
  assert.match(sectionFor(month, "2026-08-24"), /上海早会/);
  assert.equal(sectionFor(month, "2026-08-24").includes("洛杉矶回顾"), false);
  assert.match(sectionFor(month, "2026-08-23"), /洛杉矶回顾/);

  const week = contribution.renderFace({ type: "schedule-week" }, context);
  assert.match(sectionFor(week, "2026-08-24"), /上海早会/);
  assert.equal(week.includes("洛杉矶回顾"), false);

  const day = contribution.renderFace({ type: "schedule-day" }, context);
  assert.match(day, /上海早会/);
  assert.equal(day.includes("洛杉矶回顾"), false);
  assert.equal(contribution.renderFace({ type: "not-schedule" }, context), null);
});

test("Schedule live polling refreshes only changed external, awaiting, and reference snapshots", async () => {
  let currentNow = new Date("2026-08-24T12:00:00.000Z");
  let fixtures = [item({
    title: "外部更新前",
    scheduledStartAt: "2026-08-24T12:10:00.000Z",
    timezone: "UTC",
    awaitingConfirmation: false,
  })];
  const paths: string[] = [];
  let refreshCalls = 0;
  const contribution = await activate({
    now: () => currentNow,
    refresh: async () => { refreshCalls++; },
    api: async (path: string) => {
      paths.push(path);
      return fixtures;
    },
  });

  const initial = await contribution.load();
  const initialReference = initial.scheduleCalendar.referenceKey;
  await contribution.loadLive();
  assert.equal(refreshCalls, 0, "an unchanged live snapshot must preserve the book DOM");

  fixtures = [{ ...fixtures[0], title: "CLI 已更新", version: 2 }];
  const external = await contribution.loadLive();
  assert.equal(external.scheduleItems[0].title, "CLI 已更新");
  assert.equal(refreshCalls, 1, "an external API/CLI mutation must refresh Schedule faces");
  await contribution.loadLive();
  assert.equal(refreshCalls, 1, "the same external snapshot must not rebuild twice");

  currentNow = new Date("2026-08-24T12:10:00.000Z");
  await contribution.loadLive();
  assert.equal(refreshCalls, 2, "crossing scheduledStartAt must refresh derived awaiting state");
  await contribution.loadLive();
  assert.equal(refreshCalls, 2, "stable awaiting state must not rebuild every live tick");

  currentNow = new Date("2026-08-25T12:00:00.000Z");
  const rolled = await contribution.loadLive();
  assert.notEqual(rolled.scheduleCalendar.referenceKey, initialReference);
  assert.equal(refreshCalls, 3, "reference-date rollover must refresh the calendar window");
  assert.equal(paths.length, 7, "every live tick must poll the canonical Schedule range");
});

test("Schedule coalesces overlapping live snapshot refreshes", async () => {
  const base = item({ title: "v1", version: 1 });
  const responses = [
    [base],
    [{ ...base, title: "v2", version: 2 }],
    [{ ...base, title: "v3", version: 3 }],
  ];
  let apiCalls = 0;
  let refreshCalls = 0;
  const firstRefresh = deferred<void>();
  const contribution = await activate({
    now: () => NOW,
    api: async () => responses[Math.min(apiCalls++, responses.length - 1)],
    refresh: async () => {
      refreshCalls++;
      if (refreshCalls === 1) await firstRefresh.promise;
    },
  });
  await contribution.load();

  const firstLive = contribution.loadLive();
  while (refreshCalls === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  const secondLive = contribution.loadLive();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 1, "overlapping polls must share the active refresh");

  firstRefresh.resolve();
  const [, latest] = await Promise.all([firstLive, secondLive]);
  assert.equal(refreshCalls, 2, "one distinct queued snapshot receives one follow-up refresh");
  assert.equal(latest.scheduleItems[0].title, "v3");
  await contribution.loadLive();
  assert.equal(refreshCalls, 2, "the acknowledged queued snapshot must remain stable");
});

test("Schedule does not run a queued refresh after focus begins mid-refresh", async () => {
  const base = item({ title: "v1", version: 1 });
  const responses = [
    [base],
    [{ ...base, title: "v2", version: 2 }],
    [{ ...base, title: "v3", version: 3 }],
  ];
  let apiCalls = 0;
  let refreshCalls = 0;
  const firstRefresh = deferred<void>();
  const { root, documentRef } = styleRoot();
  const contribution = await activate({
    root,
    now: () => NOW,
    api: async () => responses[Math.min(apiCalls++, responses.length - 1)],
    refresh: async () => {
      refreshCalls++;
      if (refreshCalls === 1) await firstRefresh.promise;
    },
  });
  await contribution.load();

  const firstLive = contribution.loadLive();
  while (refreshCalls === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  documentRef.activeElement = {
    tagName: "INPUT",
    closest(selector: string) {
      return selector === "#pages" ? {} : null;
    },
  };
  await contribution.loadLive();
  firstRefresh.resolve();
  await firstLive;
  assert.equal(
    refreshCalls,
    1,
    "a queued snapshot must not rebuild after an input gains focus"
  );

  documentRef.activeElement = null;
  await contribution.loadLive();
  assert.equal(refreshCalls, 2, "the queued snapshot must refresh on the first post-blur poll");
});

test("Schedule defers changed live snapshots while a book input has focus", async () => {
  const original = item({ title: "before edit", version: 1 });
  let fixtures = [original];
  let refreshCalls = 0;
  const { root, documentRef } = styleRoot();
  const contribution = await activate({
    root,
    now: () => NOW,
    api: async () => fixtures,
    refresh: async () => { refreshCalls++; },
  });
  await contribution.load();
  fixtures = [{ ...original, title: "external change", version: 2 }];
  documentRef.activeElement = {
    tagName: "INPUT",
    closest(selector: string) {
      return selector === "#pages" ? {} : null;
    },
  };

  await contribution.loadLive();
  assert.equal(refreshCalls, 0, "live polling must not destroy a focused book input");
  documentRef.activeElement = null;
  await contribution.loadLive();
  assert.equal(refreshCalls, 1, "the deferred snapshot must refresh after editing ends");
  await contribution.loadLive();
  assert.equal(refreshCalls, 1);
});

test("Schedule ignores late live responses and future polls after unmount", async () => {
  const original = item({ title: "mounted", version: 1 });
  const pending = deferred<ReturnType<typeof item>[]>();
  let apiCalls = 0;
  let refreshCalls = 0;
  const { root, links } = styleRoot();
  const contribution = await activate({
    root,
    now: () => NOW,
    refresh: async () => { refreshCalls++; },
    api: async () => {
      apiCalls++;
      return apiCalls === 1 ? [original] : pending.promise;
    },
  });
  await contribution.load();
  const live = contribution.loadLive();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await contribution.unmount();
  assert.equal(links.length, 0);

  pending.resolve([{ ...original, title: "late", version: 2 }]);
  assert.deepEqual(await live, {});
  assert.equal(refreshCalls, 0, "a late response after unmount must not refresh");
  const callsAfterUnmount = apiCalls;
  assert.deepEqual(await contribution.loadLive(), {});
  assert.equal(apiCalls, callsAfterUnmount, "an unmounted contribution must not poll again");
  assert.equal(refreshCalls, 0);
});

test("Schedule escapes every dynamic render value and never fabricates notification controls", async () => {
  const malicious = item({
    id: 'id"><svg onload=alert(1)>',
    title: '<img src=x onerror="alert(2)">',
    description: "</textarea><script>alert(3)</script>",
    timezone: '"><script>alert(4)</script>',
    scheduledStartAt: "2026-08-23T00:00:00.000Z",
  });
  const contribution = await activate({ api: async () => [malicious], now: () => NOW });
  const data = await contribution.load();
  const html = contribution.renderFace({ type: "schedule-overview" }, renderContext(data.scheduleItems));

  assert.equal(html.includes(malicious.id), false);
  assert.equal(html.includes(malicious.title), false);
  assert.equal(html.includes(malicious.description ?? ""), false);
  assert.equal(html.includes(malicious.timezone), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(2\)&quot;&gt;/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.equal(html.includes("notification"), false);
  assert.equal(html.includes("schedule-ignore"), false);
});

test("Schedule create and explicit actions use canonical routes, latest expectedVersion, and no write on ignore", async () => {
  const original = item({
    id: "item/with space",
    version: 7,
    scheduledStartAt: "2026-08-23T00:00:00.000Z",
  });
  const actionId = `overview:${encodeURIComponent(original.id)}`;
  const calls: Array<{ path: string; options?: { method?: string; body?: string } }> = [];
  let returnedVersion = original.version;
  const contribution = await activate({
    now: () => NOW,
    api: async (path: string, options?: { method?: string; body?: string }) => {
      calls.push({ path, options });
      if (!options) return [original];
      if (path === "/plugins/schedule/items") return item({ id: "created" });
      returnedVersion++;
      return { ...original, version: returnedVersion };
    },
  });
  await contribution.load();
  const elements: Record<string, { value?: string; textContent?: string }> = {
    scheduleTitle: { value: "写发布说明" },
    scheduleDescription: { value: "说明" },
    scheduleStart: { value: "2026-08-25T09:00:00+08:00" },
    scheduleEnd: { value: "2026-08-25T10:30:00+08:00" },
    scheduleTimezone: { value: "Asia/Shanghai" },
    schedulePriority: { value: "12" },
    scheduleCreateError: { textContent: "" },
    scheduleActionError: { textContent: "" },
    [`scheduleSnooze:${actionId}`]: { value: "15" },
  };
  const $ = (id: string) => elements[id] ?? null;

  const beforeIgnore = calls.length;
  assert.deepEqual(await contribution.handleAction("schedule-ignore", {
    id: original.id, $, confirm: () => true,
  }), { handled: true, refresh: false });
  assert.equal(calls.length, beforeIgnore);

  await contribution.handleAction("schedule-create", { id: "", $, confirm: () => true });
  const createCall = calls.at(-1);
  assert.equal(createCall?.path, "/plugins/schedule/items");
  assert.equal(createCall?.options?.method, "POST");
  assert.deepEqual(JSON.parse(createCall?.options?.body ?? ""), {
    title: "写发布说明",
    description: "说明",
    scheduledStartAt: "2026-08-25T09:00:00+08:00",
    scheduledEndAt: "2026-08-25T10:30:00+08:00",
    timezone: "Asia/Shanghai",
    priority: 12,
  });

  await contribution.handleAction("schedule-confirm-start", {
    id: actionId, $, confirm: () => true,
  });
  await contribution.handleAction("schedule-snooze", {
    id: actionId, $, confirm: () => true,
  });
  await contribution.handleAction("schedule-complete", {
    id: actionId, $, confirm: () => true,
  });
  const beforeRejectedCancel = calls.length;
  await contribution.handleAction("schedule-cancel", {
    id: actionId, $, confirm: () => false,
  });
  assert.equal(calls.length, beforeRejectedCancel);
  await contribution.handleAction("schedule-cancel", {
    id: actionId, $, confirm: () => true,
  });

  const transitionCalls = calls.filter((call) => call.path.includes("item%2Fwith%20space"));
  assert.deepEqual(transitionCalls.map((call) => call.path), [
    "/plugins/schedule/items/item%2Fwith%20space/confirm-start",
    "/plugins/schedule/items/item%2Fwith%20space/snooze",
    "/plugins/schedule/items/item%2Fwith%20space/complete",
    "/plugins/schedule/items/item%2Fwith%20space/cancel",
  ]);
  assert.deepEqual(transitionCalls.map((call) => JSON.parse(call.options?.body ?? "")), [
    { expectedVersion: 7 },
    { expectedVersion: 8, nextReminderAt: "2026-08-24T00:15:00.000Z" },
    { expectedVersion: 9 },
    { expectedVersion: 10 },
  ]);
});

test("Schedule scopes duplicate item controls by face and day snooze reads only the day input", async () => {
  const adversarialId = 'item/with:%"><svg data-x="1">';
  const scheduled = item({
    id: adversarialId,
    title: "跨页面日程",
    scheduledStartAt: "2026-08-23T23:30:00.000Z",
    timezone: "Asia/Shanghai",
    version: 21,
  });
  const calls: Array<{ path: string; options?: { body?: string } }> = [];
  const contribution = await activate({
    now: () => NOW,
    api: async (path: string, options?: { body?: string }) => {
      calls.push({ path, options });
      return options ? { ...scheduled, version: 22 } : [scheduled];
    },
  });
  const data = await contribution.load();
  const context = renderContext(data.scheduleItems);
  const overview = contribution.renderFace({ type: "schedule-overview" }, context);
  const day = contribution.renderFace({ type: "schedule-day" }, context);
  const controlIds = [...`${overview}${day}`.matchAll(/\bid="(scheduleSnooze:[^"]+)"/g)]
    .map((match) => match[1]);
  assert.equal(controlIds.length, 2);
  assert.equal(new Set(controlIds).size, 2);
  assert.match(controlIds[0], /^scheduleSnooze:overview:/);
  assert.match(controlIds[1], /^scheduleSnooze:day:/);
  assert.equal(overview.includes(adversarialId), false);
  assert.equal(day.includes(adversarialId), false);

  const dayTarget = day.match(/data-act="schedule-snooze" data-id="([^"]+)"/)?.[1];
  assert.ok(dayTarget);
  const elements: Record<string, { value?: string; textContent?: string }> = {
    [controlIds[0]]: { value: "3" },
    [controlIds[1]]: { value: "47" },
    scheduleActionError: { textContent: "" },
  };
  await contribution.handleAction("schedule-snooze", {
    id: dayTarget,
    $: (id: string) => elements[id] ?? null,
    confirm: () => true,
  });

  const snooze = calls.at(-1);
  assert.equal(
    snooze?.path,
    `/plugins/schedule/items/${encodeURIComponent(adversarialId)}/snooze`
  );
  assert.deepEqual(JSON.parse(snooze?.options?.body ?? ""), {
    expectedVersion: 21,
    nextReminderAt: "2026-08-24T00:47:00.000Z",
  });
});

test("Schedule routes action errors to the originating overview or day face", async () => {
  const scheduled = item({
    scheduledStartAt: "2026-08-23T23:30:00.000Z",
    timezone: "Asia/Shanghai",
  });
  const contribution = await activate({
    now: () => NOW,
    api: async (_path: string, options?: unknown) => {
      if (!options) return [scheduled];
      throw new Error("backend failed");
    },
  });
  const data = await contribution.load();
  const context = renderContext(data.scheduleItems);
  const overview = contribution.renderFace({ type: "schedule-overview" }, context);
  const day = contribution.renderFace({ type: "schedule-day" }, context);
  const overviewTarget = overview.match(
    /data-act="schedule-confirm-start" data-id="([^"]+)"/
  )?.[1];
  const dayTarget = day.match(
    /data-act="schedule-confirm-start" data-id="([^"]+)"/
  )?.[1];
  assert.ok(overviewTarget);
  assert.ok(dayTarget);

  const errors = {
    scheduleActionError: { textContent: "" },
    scheduleActionErrorDay: { textContent: "" },
  };
  const $ = (id: string) => errors[id as keyof typeof errors] ?? null;
  await contribution.handleAction("schedule-confirm-start", {
    id: dayTarget,
    $,
    confirm: () => true,
  });
  assert.equal(errors.scheduleActionError.textContent, "");
  assert.equal(errors.scheduleActionErrorDay.textContent, "backend failed");

  errors.scheduleActionErrorDay.textContent = "";
  await contribution.handleAction("schedule-confirm-start", {
    id: overviewTarget,
    $,
    confirm: () => true,
  });
  assert.equal(errors.scheduleActionError.textContent, "backend failed");
  assert.equal(errors.scheduleActionErrorDay.textContent, "");
});

test("Schedule Web accepts the same minute and second precision offsets as the API", async () => {
  const calls: Array<{ path: string; options?: { body?: string } }> = [];
  const contribution = await activate({
    now: () => NOW,
    api: async (path: string, options?: { body?: string }) => {
      calls.push({ path, options });
      return item();
    },
  });
  const elements: Record<string, { value?: string; textContent?: string }> = {
    scheduleTitle: { value: "精度一致" },
    scheduleDescription: { value: "" },
    scheduleStart: { value: "2026-08-25T09:00+08:00" },
    scheduleEnd: { value: "2026-08-25T10:30:00.123456+08:00" },
    scheduleTimezone: { value: "Asia/Shanghai" },
    schedulePriority: { value: "0" },
    scheduleCreateError: { textContent: "" },
  };
  await contribution.handleAction("schedule-create", {
    id: "",
    $: (id: string) => elements[id] ?? null,
    confirm: () => true,
  });
  assert.equal(elements.scheduleCreateError.textContent, "");
  const payload = JSON.parse(calls.at(-1)?.options?.body ?? "");
  assert.equal(payload.scheduledStartAt, "2026-08-25T09:00+08:00");
  assert.equal(
    payload.scheduledEndAt,
    "2026-08-25T10:30:00.123456+08:00"
  );
});

test("Schedule validates create and snooze locally without issuing a write", async () => {
  const calls: string[] = [];
  const contribution = await activate({
    now: () => NOW,
    api: async (path: string, options?: unknown) => {
      calls.push(path);
      return options ? item() : [item()];
    },
  });
  await contribution.load();
  const elements: Record<string, { value?: string; textContent?: string }> = {
    scheduleTitle: { value: "无偏移时刻" },
    scheduleDescription: { value: "" },
    scheduleStart: { value: "2026-08-25T09:00" },
    scheduleEnd: { value: "" },
    scheduleTimezone: { value: "Asia/Shanghai" },
    schedulePriority: { value: "0" },
    scheduleCreateError: { textContent: "" },
    scheduleActionError: { textContent: "" },
    "scheduleSnooze:schedule-1": { value: "0" },
  };
  const $ = (id: string) => elements[id] ?? null;
  const before = calls.length;
  await contribution.handleAction("schedule-create", { id: "", $, confirm: () => true });
  await contribution.handleAction("schedule-snooze", { id: "schedule-1", $, confirm: () => true });
  assert.equal(calls.length, before);
  assert.match(elements.scheduleCreateError.textContent ?? "", /Z|偏移/);
  assert.match(elements.scheduleActionError.textContent ?? "", /1 至 10080/);
});

test("Schedule owns exactly one stylesheet and removes it idempotently on unmount", async () => {
  const { root, links } = styleRoot();
  const contribution = await activate({ root, api: async () => [], now: () => NOW });
  assert.equal(links.length, 1);
  assert.equal(links[0].rel, "stylesheet");
  assert.equal(links[0].href, "/plugins/schedule/styles.css");
  assert.equal(links[0].dataset.echologPluginStyle, "schedule");
  await contribution.unmount();
  assert.equal(links.length, 0);
  await contribution.unmount();
  assert.equal(links.length, 0);
});

test("plugin Web host activates Schedule only while it is enabled and ready", async () => {
  const modulePath = new URL("../plugins/schedule/web/index.js", import.meta.url).href;
  const { root, links } = styleRoot();
  let state: "disabled" | "degraded" | "ready" = "disabled";
  const host = createPluginWebHost(async (path: string) => {
    assert.equal(path, "/plugins");
    return {
      plugins: [{ id: "schedule", enabled: state !== "disabled", state, webEntry: modulePath }],
    };
  });
  const hostApi = { root, api: async () => [], now: () => NOW };

  await host.refresh(hostApi);
  assert.deepEqual(host.faces(), []);
  assert.equal(links.length, 0);
  state = "degraded";
  await host.refresh(hostApi);
  assert.deepEqual(host.faces(), []);
  assert.equal(links.length, 0);
  state = "ready";
  await host.refresh(hostApi);
  assert.equal(host.faces().length, 4);
  assert.equal(links.length, 1);
  await host.refresh(hostApi);
  assert.equal(links.length, 1);
  state = "degraded";
  await host.refresh(hostApi);
  assert.deepEqual(host.faces(), []);
  assert.equal(links.length, 0);
});
