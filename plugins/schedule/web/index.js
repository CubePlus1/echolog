const SCHEDULE_STYLE_HREF = "/plugins/schedule/styles.css";
const SCHEDULE_FACE_TYPES = new Set([
  "schedule-overview",
  "schedule-month",
  "schedule-week",
  "schedule-day",
]);
const VALID_STATUSES = new Set(["scheduled", "active", "done", "cancelled"]);
const ACTION_SURFACES = new Set(["overview", "day"]);
const STATUS_LABELS = {
  scheduled: "待时",
  awaiting: "待确认",
  active: "进行中",
  done: "已完成",
  cancelled: "已取消",
};
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function dateFromKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error(`invalid date key: ${key}`);
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) {
    throw new Error(`invalid date key: ${key}`);
  }
  return date;
}

function keyFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(key, amount) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromDate(date);
}

function localDateKey(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function startOfWeek(key) {
  const day = dateFromKey(key).getUTCDay();
  return addDays(key, -((day + 6) % 7));
}

function rangeForView(view, referenceKey) {
  dateFromKey(referenceKey);
  let from;
  let length;
  if (view === "month") {
    from = startOfWeek(`${referenceKey.slice(0, 7)}-01`);
    length = 42;
  } else if (view === "week") {
    from = startOfWeek(referenceKey);
    length = 7;
  } else if (view === "day") {
    from = referenceKey;
    length = 1;
  } else {
    throw new Error(`unknown schedule view: ${view}`);
  }
  const keys = Array.from({ length }, (_, index) => addDays(from, index));
  return { from, to: addDays(from, length), keys };
}

function queryWindow(referenceKey) {
  const month = rangeForView("month", referenceKey);
  return {
    from: `${addDays(month.from, -2)}T00:00:00.000Z`,
    to: `${addDays(month.to, 2)}T00:00:00.000Z`,
  };
}

function partsInTimezone(instant, timezone) {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid instant: ${instant}`);
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateKeyInTimezone(instant, timezone) {
  const { year, month, day } = partsInTimezone(instant, timezone);
  return `${year}-${month}-${day}`;
}

function itemDateSpan(item) {
  const startMs = Date.parse(item.scheduledStartAt);
  if (!Number.isFinite(startMs)) return null;
  const startKey = dateKeyInTimezone(startMs, item.timezone);
  const parsedEnd = item.scheduledEndAt == null ? startMs : Date.parse(item.scheduledEndAt);
  const endMs = Number.isFinite(parsedEnd) && parsedEnd > startMs ? parsedEnd - 1 : startMs;
  return {
    startKey,
    endKey: dateKeyInTimezone(endMs, item.timezone),
  };
}

function compareItems(left, right) {
  const byStart = Date.parse(left.scheduledStartAt) - Date.parse(right.scheduledStartAt);
  if (byStart !== 0) return byStart;
  const byPriority = Number(right.priority || 0) - Number(left.priority || 0);
  if (byPriority !== 0) return byPriority;
  return String(left.id).localeCompare(String(right.id));
}

function groupItems(items, view, referenceKey) {
  const range = rangeForView(view, referenceKey);
  const groups = new Map(range.keys.map((key) => [key, []]));
  for (const item of Array.isArray(items) ? items : []) {
    let span;
    try {
      span = itemDateSpan(item);
    } catch {
      continue;
    }
    if (!span) continue;
    for (const key of range.keys) {
      if (key >= span.startKey && key <= span.endKey) groups.get(key).push(item);
    }
  }
  for (const entries of groups.values()) entries.sort(compareItems);
  return { ...range, groups };
}

function normalizedStatus(item) {
  return VALID_STATUSES.has(item?.status) ? item.status : "scheduled";
}

function displayStatus(item, now = new Date()) {
  const status = normalizedStatus(item);
  if (status === "scheduled" && Date.parse(item?.scheduledStartAt) <= now.getTime()) {
    return "awaiting";
  }
  return status;
}

function scheduleSnapshot(items, referenceKey, now) {
  const entries = items.map((item) => [
    String(item?.id ?? ""),
    item?.title ?? null,
    item?.description ?? null,
    item?.scheduledStartAt ?? null,
    item?.scheduledEndAt ?? null,
    item?.timezone ?? null,
    item?.priority ?? null,
    item?.status ?? null,
    item?.nextReminderAt ?? null,
    item?.confirmedStartAt ?? null,
    item?.completedAt ?? null,
    item?.cancelledAt ?? null,
    item?.version ?? null,
    displayStatus(item, now),
  ]).sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify([referenceKey, entries]);
}

function actionTarget(surface, itemId) {
  if (!ACTION_SURFACES.has(surface)) throw new Error(`unknown schedule action surface: ${surface}`);
  return `${surface}:${encodeURIComponent(String(itemId))}`;
}

function parseActionTarget(value) {
  const target = String(value ?? "");
  const separator = target.indexOf(":");
  const surface = separator >= 0 ? target.slice(0, separator) : "";
  if (!ACTION_SURFACES.has(surface)) {
    return { itemId: target, target, surface: "overview" };
  }
  try {
    return {
      itemId: decodeURIComponent(target.slice(separator + 1)),
      target,
      surface,
    };
  } catch {
    return null;
  }
}

function formatItemTime(item, locale = "zh-CN") {
  try {
    const options = {
      timeZone: item.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    };
    const start = new Intl.DateTimeFormat(locale, options).format(new Date(item.scheduledStartAt));
    if (!item.scheduledEndAt) return start;
    const end = new Intl.DateTimeFormat(locale, options).format(new Date(item.scheduledEndAt));
    return `${start}–${end}`;
  } catch {
    return String(item.scheduledStartAt || "");
  }
}

function mountStylesheet(root) {
  const documentRef = root?.ownerDocument ?? globalThis.document;
  if (!documentRef?.createElement) return null;
  const link = documentRef.createElement("link");
  link.rel = "stylesheet";
  link.href = SCHEDULE_STYLE_HREF;
  link.dataset.echologPluginStyle = "schedule";
  (documentRef.head ?? root)?.appendChild(link);
  return link;
}

function renderStatus(item, now, esc) {
  const status = displayStatus(item, now);
  return `<span class="schedule-state is-${status}">${esc(STATUS_LABELS[status])}</span>`;
}

function renderActions(item, { escA }, surface) {
  const target = actionTarget(surface, item.id);
  const escapedTarget = escA(target);
  const status = normalizedStatus(item);
  if (status === "done" || status === "cancelled") return "";
  const complete = `<button type="button" data-act="schedule-complete" data-id="${escapedTarget}">完成</button>`;
  const cancel = `<button type="button" data-act="schedule-cancel" data-id="${escapedTarget}">取消</button>`;
  if (status === "active") {
    return `<div class="schedule-actions">${complete}${cancel}</div>`;
  }
  return `<div class="schedule-actions">
    <button class="schedule-primary" type="button" data-act="schedule-confirm-start" data-id="${escapedTarget}">确认开始</button>
    <label class="schedule-snooze"><input id="scheduleSnooze:${escapedTarget}" type="number" min="1" max="10080" value="10" inputmode="numeric" /> 分钟</label>
    <button type="button" data-act="schedule-snooze" data-id="${escapedTarget}">稍后提醒</button>
    ${complete}${cancel}
  </div>`;
}

function renderItem(item, context, now, { compact = false, surface = null } = {}) {
  const { esc, escA } = context;
  const description = !compact && item.description
    ? `<p class="schedule-description">${esc(item.description)}</p>`
    : "";
  const actions = compact ? "" : renderActions(item, context, surface);
  return `<article class="schedule-item schedule-${displayStatus(item, now)}" data-schedule-id="${escA(item.id)}">
    <div class="schedule-item-head">
      <strong>${esc(item.title)}</strong>
      ${renderStatus(item, now, esc)}
    </div>
    <div class="schedule-time">${esc(formatItemTime(item))} · ${esc(item.timezone)}</div>
    ${description}
    ${actions}
  </article>`;
}

function renderCreateForm(context) {
  const { escA } = context;
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `<section class="schedule-create" aria-label="新建日程">
    <div class="toc-section">添一程</div>
    <div class="schedule-form-grid">
      <input class="form-input" id="scheduleTitle" type="text" maxlength="200" placeholder="日程标题" />
      <input class="form-input" id="scheduleStart" type="text" placeholder="开始：2026-08-24T09:00:00+08:00" />
      <input class="form-input" id="scheduleEnd" type="text" placeholder="结束（可空，须含 Z 或偏移）" />
      <input class="form-input" id="scheduleTimezone" type="text" value="${escA(detectedTimezone)}" placeholder="IANA 时区，如 Asia/Shanghai" />
      <input class="form-input" id="schedulePriority" type="number" min="-1000" max="1000" value="0" placeholder="优先级" />
      <textarea class="form-input" id="scheduleDescription" maxlength="2000" placeholder="说明（可空）"></textarea>
    </div>
    <div class="form-error" id="scheduleCreateError"></div>
    <button class="seal-btn schedule-create-button" type="button" data-act="schedule-create"><span class="s-face">程</span><span class="s-label">添日程</span></button>
  </section>`;
}

function renderOverview(items, context, now) {
  const actionable = items
    .filter((item) => ["scheduled", "active"].includes(normalizedStatus(item)))
    .sort(compareItems)
    .slice(0, 8);
  return `<div class="leaf-inner toc-face schedule-face schedule-overview-face">
    <div class="toc-title">日 程</div>
    <div class="form-hint">到时只作提醒；唯有你确认，方才开始。</div>
    ${renderCreateForm(context)}
    <div class="schedule-action-error form-error" id="scheduleActionError"></div>
    <div class="toc-scroll schedule-agenda">
      ${actionable.map((item) => renderItem(item, context, now, { surface: "overview" })).join("") || '<p class="toc-empty">近日无待办日程。</p>'}
    </div>
  </div>`;
}

function renderMonth(items, referenceKey, context, now) {
  const { esc, escA } = context;
  const calendar = groupItems(items, "month", referenceKey);
  const currentMonth = referenceKey.slice(0, 7);
  const cells = calendar.keys.map((key) => {
    const entries = calendar.groups.get(key);
    const outside = key.slice(0, 7) !== currentMonth ? " is-outside" : "";
    const rendered = entries.slice(0, 3).map((item) => renderItem(item, context, now, { compact: true })).join("");
    const rest = entries.length > 3 ? `<span class="schedule-more">另 ${esc(entries.length - 3)} 项</span>` : "";
    return `<section class="schedule-month-day${outside}" data-date="${escA(key)}">
      <span class="schedule-date-number">${esc(Number(key.slice(8, 10)))}</span>${rendered}${rest}
    </section>`;
  }).join("");
  return `<div class="leaf-inner toc-face schedule-face schedule-month-face">
    <div class="toc-title">月 览</div>
    <div class="schedule-range-title">${esc(currentMonth)} · 每项依自身时区归日</div>
    <div class="schedule-weekdays">${WEEKDAY_LABELS.map((label) => `<span>${label}</span>`).join("")}</div>
    <div class="schedule-month-grid">${cells}</div>
  </div>`;
}

function renderWeek(items, referenceKey, context, now) {
  const { esc, escA } = context;
  const calendar = groupItems(items, "week", referenceKey);
  const days = calendar.keys.map((key, index) => {
    const entries = calendar.groups.get(key);
    return `<section class="schedule-week-day" data-date="${escA(key)}">
      <div class="schedule-week-date"><span>周${WEEKDAY_LABELS[index]}</span><strong>${esc(key.slice(5))}</strong></div>
      <div class="schedule-week-items">${entries.map((item) => renderItem(item, context, now, { compact: true })).join("") || '<span class="toc-empty">无</span>'}</div>
    </section>`;
  }).join("");
  return `<div class="leaf-inner toc-face schedule-face schedule-week-face">
    <div class="toc-title">周 览</div>
    <div class="schedule-range-title">${esc(calendar.from)} — ${esc(addDays(calendar.to, -1))}</div>
    <div class="toc-scroll schedule-week-list">${days}</div>
  </div>`;
}

function renderDay(items, referenceKey, context, now) {
  const { esc } = context;
  const calendar = groupItems(items, "day", referenceKey);
  const entries = calendar.groups.get(referenceKey);
  return `<div class="leaf-inner toc-face schedule-face schedule-day-face">
    <div class="toc-title">日 览</div>
    <div class="schedule-range-title">${esc(referenceKey)} · 每项显示其 IANA 时区</div>
    <div class="schedule-action-error form-error" id="scheduleActionErrorDay"></div>
    <div class="toc-scroll schedule-agenda">
      ${entries.map((item) => renderItem(item, context, now, { surface: "day" })).join("") || '<p class="toc-empty">今日无日程。</p>'}
    </div>
  </div>`;
}

function explicitOffsetInstant(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function activate({
  api,
  root,
  refresh = async () => {},
  now: nowFactory = () => new Date(),
}) {
  const stylesheet = mountStylesheet(root);
  let referenceKey = localDateKey(nowFactory());
  let latestItems = [];
  let latestCalendar = { referenceKey, ...queryWindow(referenceKey) };
  let observedSnapshot = "";
  let renderedSnapshot = "";
  let snapshotRequestGeneration = 0;
  let fullLoadGeneration = 0;
  let refreshPromise = null;
  let mounted = true;

  const setError = ($, id, error) => {
    const element = $(id) ?? $("scheduleActionError") ?? $("scheduleActionErrorDay");
    if (element) element.textContent = error instanceof Error ? error.message : String(error || "");
  };

  const replaceLatest = (updated) => {
    if (!updated?.id) return;
    latestItems = latestItems.map((item) => item.id === updated.id ? updated : item);
  };

  const currentData = () => ({
    scheduleItems: latestItems,
    scheduleCalendar: latestCalendar,
  });

  const isEditing = () => {
    const documentRef = root?.ownerDocument ?? globalThis.document;
    const element = documentRef?.activeElement;
    return Boolean(
      element?.closest?.("#pages") &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
    );
  };

  const fetchSnapshot = async () => {
    const observedAt = nowFactory();
    const nextReferenceKey = localDateKey(observedAt);
    const window = queryWindow(nextReferenceKey);
    const path = `/plugins/schedule/items?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;
    const result = await api(path);
    if (!Array.isArray(result)) {
      throw new Error("Schedule items response must be an array");
    }
    return {
      items: result,
      calendar: { referenceKey: nextReferenceKey, ...window },
      signature: scheduleSnapshot(result, nextReferenceKey, observedAt),
    };
  };

  const applySnapshot = (snapshot, rendered) => {
    referenceKey = snapshot.calendar.referenceKey;
    latestItems = snapshot.items;
    latestCalendar = snapshot.calendar;
    observedSnapshot = snapshot.signature;
    if (rendered) renderedSnapshot = snapshot.signature;
  };

  const requestRefresh = async () => {
    if (!mounted || isEditing() || observedSnapshot === renderedSnapshot) return;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      while (mounted && !isEditing() && observedSnapshot !== renderedSnapshot) {
        const targetSnapshot = observedSnapshot;
        const loadGeneration = fullLoadGeneration;
        await refresh();
        if (!mounted) return;
        // The real Host refresh performs a full load, which installs the
        // rendered snapshot. Tests and embedders may provide a lighter
        // callback, so acknowledge the requested target only when no full
        // load happened while the refresh was in flight.
        if (fullLoadGeneration === loadGeneration) {
          renderedSnapshot = targetSnapshot;
        }
      }
    })();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  };

  return {
    id: "schedule",
    async load() {
      const requestGeneration = ++snapshotRequestGeneration;
      const snapshot = await fetchSnapshot();
      if (!mounted) return {};
      if (requestGeneration !== snapshotRequestGeneration) return currentData();
      fullLoadGeneration++;
      applySnapshot(snapshot, true);
      return currentData();
    },
    async loadLive() {
      if (!mounted) return {};
      const requestGeneration = ++snapshotRequestGeneration;
      const snapshot = await fetchSnapshot();
      if (!mounted) return {};
      if (requestGeneration !== snapshotRequestGeneration) return currentData();
      if (!renderedSnapshot) {
        applySnapshot(snapshot, true);
      } else {
        applySnapshot(snapshot, false);
        await requestRefresh();
      }
      return mounted ? currentData() : {};
    },
    faces() {
      return [...SCHEDULE_FACE_TYPES].map((type) => ({ type }));
    },
    renderFace(face, context) {
      if (!SCHEDULE_FACE_TYPES.has(face?.type)) return null;
      const items = Array.isArray(context.data?.scheduleItems)
        ? context.data.scheduleItems
        : latestItems;
      const renderNow = nowFactory();
      if (face.type === "schedule-overview") return renderOverview(items, context, renderNow);
      if (face.type === "schedule-month") return renderMonth(items, referenceKey, context, renderNow);
      if (face.type === "schedule-week") return renderWeek(items, referenceKey, context, renderNow);
      return renderDay(items, referenceKey, context, renderNow);
    },
    async handleAction(action, { id, $, confirm }) {
      if (action === "schedule-ignore") return { handled: true, refresh: false };
      if (action === "schedule-create") {
        const title = ($("scheduleTitle")?.value ?? "").trim();
        const description = ($("scheduleDescription")?.value ?? "").trim();
        const scheduledStartAt = ($("scheduleStart")?.value ?? "").trim();
        const scheduledEndInput = ($("scheduleEnd")?.value ?? "").trim();
        const timezone = ($("scheduleTimezone")?.value ?? "").trim();
        const priority = Number($("schedulePriority")?.value ?? 0);
        let error = "";
        if (!title) error = "日程标题不可为空。";
        else if (!explicitOffsetInstant(scheduledStartAt)) error = "开始时刻须含 Z 或明确偏移。";
        else if (scheduledEndInput && !explicitOffsetInstant(scheduledEndInput)) error = "结束时刻须含 Z 或明确偏移。";
        else if (scheduledEndInput && Date.parse(scheduledEndInput) <= Date.parse(scheduledStartAt)) error = "结束时刻须晚于开始时刻。";
        else if (!validTimezone(timezone)) error = "请填写有效的 IANA 时区。";
        else if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) error = "优先级须为 -1000 至 1000 的整数。";
        if (error) {
          setError($, "scheduleCreateError", error);
          return { handled: true, refresh: false };
        }
        try {
          await api("/plugins/schedule/items", {
            method: "POST",
            body: JSON.stringify({
              title,
              description: description || null,
              scheduledStartAt,
              scheduledEndAt: scheduledEndInput || null,
              timezone,
              priority,
            }),
          });
          setError($, "scheduleCreateError", "");
          return { handled: true, message: "日程已添 · 待时" };
        } catch (error) {
          setError($, "scheduleCreateError", error);
          return { handled: true, refresh: false };
        }
      }

      const routeByAction = {
        "schedule-confirm-start": "confirm-start",
        "schedule-snooze": "snooze",
        "schedule-complete": "complete",
        "schedule-cancel": "cancel",
      };
      const route = routeByAction[action];
      if (!route) return { handled: false };
      const parsedTarget = parseActionTarget(id);
      if (!parsedTarget) return { handled: true, refresh: false };
      const actionErrorId = parsedTarget.surface === "day"
        ? "scheduleActionErrorDay"
        : "scheduleActionError";
      const item = latestItems.find((candidate) => candidate.id === parsedTarget.itemId);
      if (!item) return { handled: true, refresh: false };
      if (action === "schedule-cancel" && !confirm("取消此日程？")) {
        return { handled: true, refresh: false };
      }
      const body = { expectedVersion: item.version };
      if (action === "schedule-snooze") {
        const minutes = Number($(`scheduleSnooze:${parsedTarget.target}`)?.value ?? 10);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
          setError($, actionErrorId, "稍后提醒须为 1 至 10080 分钟。");
          return { handled: true, refresh: false };
        }
        body.nextReminderAt = new Date(nowFactory().getTime() + minutes * 60_000).toISOString();
      }
      try {
        const updated = await api(`/plugins/schedule/items/${encodeURIComponent(parsedTarget.itemId)}/${route}`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        replaceLatest(updated);
        setError($, actionErrorId, "");
        const message = {
          "schedule-confirm-start": "已确认开始 · 行",
          "schedule-snooze": "提醒已顺延",
          "schedule-complete": "日程已完成 · 毕",
          "schedule-cancel": "日程已取消 · 罢",
        }[action];
        return { handled: true, message };
      } catch (error) {
        setError($, actionErrorId, error);
        return { handled: true, refresh: false };
      }
    },
    async unmount() {
      mounted = false;
      snapshotRequestGeneration++;
      stylesheet?.remove?.();
    },
  };
}

export const scheduleWebTest = Object.freeze({
  addDays,
  dateKeyInTimezone,
  displayStatus,
  groupItems,
  itemDateSpan,
  queryWindow,
  rangeForView,
  scheduleSnapshot,
});
