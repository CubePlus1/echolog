import { createPluginWebHost } from "./plugin-host.js";
import { currentPeriod, periodBounds, volumeKey } from "./volumes.js";

/**
 * 回声志 · EchoLog 立体前端逻辑
 * - CSS 3D 翻页书（每张 sheet 正反两面，翻转 rotateY）
 * - 鼠标视差环视、键盘/滚轮/拖拽翻页、年代时间轴、尘埃粒子
 * - 数据源：EchoLog API（/api/records、/api/records/active、/api/summary/today）
 * - 书末「今日 · 此刻」卷：今日总览、进行中任务（实时计时 + 印章操作）、始一事表单
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ============ API ============ */

  async function api(path, options) {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options && options.body ? { "Content-Type": "application/json" } : {}),
        ...(options && options.headers),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  }

  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
  const patchReq = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body) });
  const del = (path) => api(path, { method: "DELETE" });
  const pluginWebHost = createPluginWebHost(api);

  /* ============ 汉字数字 ============ */

  const CN_DIGITS = "〇一二三四五六七八九";

  function cnYear(y) {
    return String(y).split("").map((d) => CN_DIGITS[+d]).join("");
  }

  function cnNum(n) {
    // 1..99 常规读法
    if (n <= 10) return n === 10 ? "十" : CN_DIGITS[n];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return (tens > 1 ? CN_DIGITS[tens] : "") + "十" + (ones ? CN_DIGITS[ones] : "");
  }

  const cnMonth = (m) => cnNum(m) + "月";
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  function fmtClockHM(d) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function fmtDur(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h} 时 ${m} 分`;
    if (m > 0) return `${m} 分`;
    return `${s % 60} 秒`;
  }

  function fmtTimer(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\n/g, "<br />");
  }

  // 属性值转义（不含 <br/> 转换）
  function escA(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const TYPE_INFO = {
    learning: { label: "学习", seal: "学" },
    project: { label: "项目", seal: "造" },
    task: { label: "任务", seal: "务" },
  };
  const typeInfo = (t) => TYPE_INFO[t] || TYPE_INFO.task;

  /* ============ 数据 ============ */

  const data = {
    records: [],   // 全部记录（父子关系与表单候选）
    history: [],   // done/cancelled 记录，升序
    volumes: [],   // 书册索引；页内容只为当前选中的书构建
    active: [],    // running/paused（enriched）
    summary: null, // 今日总览
    latestRecordKey: "", // 轻量结构探针，避免每轮重新拉取整段历史
    screen: null,  // 今日屏幕使用（/api/screen/today）
    rules: [],     // 分类规则
    fetchedAt: 0,  // active/summary 抓取时刻（本地毫秒）
    ok: false,     // 是否成功连上后端
  };

  function applyRecords(records) {
    data.records = records;
    const latest = records[0];
    data.latestRecordKey = latest ? `${latest.id}:${latest.updatedAt || latest.status}` : "";
    data.history = records
      .filter((r) => r.status === "done" || r.status === "cancelled")
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    data.volumes = historyVolumes();
  }

  const recordById = (id) => id ? data.records.find((r) => r.id === id) || null : null;
  const directChildren = (id) => data.records.filter((r) => r.parentId === id);

  function recordDepth(record) {
    let depth = 0;
    let cursor = record;
    const visited = new Set([record.id]);
    while (cursor.parentId && depth < 8) {
      if (visited.has(cursor.parentId)) break;
      visited.add(cursor.parentId);
      cursor = recordById(cursor.parentId);
      if (!cursor) break;
      depth++;
    }
    return depth;
  }

  function subtaskProgress(id) {
    const children = directChildren(id);
    const done = children.filter((r) => r.status === "done").length;
    const cancelled = children.filter((r) => r.status === "cancelled").length;
    const active = children.filter((r) => r.status === "running" || r.status === "paused").length;
    const effectiveTotal = children.length - cancelled;
    return {
      children,
      done,
      cancelled,
      active,
      total: children.length,
      percent: effectiveTotal > 0 ? Math.round((done / effectiveTotal) * 100) : 0,
    };
  }

  function orderHierarchically(records) {
    const ids = new Set(records.map((r) => r.id));
    const byParent = new Map();
    for (const record of records) {
      const key = record.parentId && ids.has(record.parentId) ? record.parentId : null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(record);
    }
    for (const group of byParent.values()) {
      group.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    }
    const ordered = [];
    const seen = new Set();
    const visit = (record) => {
      if (seen.has(record.id)) return;
      seen.add(record.id);
      ordered.push(record);
      for (const child of byParent.get(record.id) || []) visit(child);
    };
    for (const root of byParent.get(null) || []) visit(root);
    for (const record of records) visit(record);
    return ordered;
  }

  async function loadAll() {
    const [records, active, summary] = await Promise.all([
      api("/records?limit=1000"),
      api("/records/active"),
      api("/summary/today"),
    ]);
    applyRecords(records);
    data.active = active;
    data.summary = summary;
    data.fetchedAt = Date.now();
    data.ok = true;
    await pluginWebHost.refresh({
      api,
      refresh: refreshBook,
      root: document.body,
    });
    await pluginWebHost.loadData(data);
  }

  async function loadLive() {
    const [latestRecords, active, summary] = await Promise.all([
      api("/records?limit=1"),
      api("/records/active"),
      api("/summary/today"),
    ]);
    const latest = latestRecords[0];
    data.latestRecordKey = latest ? `${latest.id}:${latest.updatedAt || latest.status}` : "";
    data.active = active;
    data.summary = summary;
    await pluginWebHost.loadData(data, { live: true });
    data.fetchedAt = Date.now();
  }

  // 活动集签名：变了才整本重排
  function liveSignature() {
    return JSON.stringify([
      data.active.map((r) => [r.id, r.status, r.title, r.project, r.tags, r.parentId]),
      data.summary ? data.summary.recordCount : 0,
      data.latestRecordKey,
    ]);
  }

  /* ============ 数据 → 页面序列 ============ */

  function volumeLabel(year, month, period = null) {
    if (period == null) return `${cnYear(year)}年${cnMonth(month)}`;
    return `${cnMonth(month)} · 第${cnNum(period)}册`;
  }

  function volumeTitle(year, month, period = null) {
    if (period == null) return `${cnYear(year)}年${cnMonth(month)} · 一月一册`;
    const bounds = periodBounds(year, month, period);
    const end = new Date(bounds.end.getTime() - 1);
    return `${volumeLabel(year, month, period)}（${bounds.start.getMonth() + 1}月${bounds.start.getDate()}日–${end.getMonth() + 1}月${end.getDate()}日）`;
  }

  function createVolume({ year, month, period = null, records = [] }, now) {
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const isCurrent = isCurrentMonth && period === currentPeriod(now);
    const bounds = period == null
      ? { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) }
      : periodBounds(year, month, period);
    return {
      key: volumeKey(year, month, period),
      year,
      month,
      period,
      records: records.sort((a, b) => new Date(a.startAt) - new Date(b.startAt)),
      count: records.length,
      start: bounds.start,
      end: bounds.end,
      isCurrentMonth,
      isCurrent,
      label: volumeLabel(year, month, period),
      title: volumeTitle(year, month, period),
    };
  }

  function historyVolumes() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentBuckets = [1, 2, 3, 4].map((period) =>
      createVolume({ year: currentYear, month: currentMonth, period, records: [] }, now)
    );
    const older = new Map();

    for (const record of data.history) {
      const date = new Date(record.startAt);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      if (year === currentYear && month === currentMonth) {
        currentBuckets[currentPeriod(date) - 1].records.push(record);
      } else {
        const key = volumeKey(year, month);
        if (!older.has(key)) older.set(key, { year, month, records: [] });
        older.get(key).records.push(record);
      }
    }

    const current = currentBuckets.map((volume) => {
      volume.count = volume.records.length;
      return volume;
    });
    const historical = [...older.values()]
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .map((volume) => createVolume(volume, now));
    return [...current, ...historical];
  }

  function entryFace(r, folio) {
    const d = new Date(r.startAt);
    const end = r.endAt ? new Date(r.endAt) : null;
    const info = typeInfo(r.type);
    const cancelled = r.status === "cancelled";
    return {
      type: "entry",
      id: r.id,
      cancelled,
      date: `${cnMonth(d.getMonth() + 1)}${cnNum(d.getDate())}日 · 周${WEEKDAYS[d.getDay()]} · ${fmtClockHM(d)}${end ? "—" + fmtClockHM(end) : ""}`,
      title: r.title,
      parentId: r.parentId,
      typeLabel: info.label,
      project: r.project,
      tags: r.tags || [],
      duration: r.durationSeconds,
      text: cancelled ? "此事中道而废，未竟。" : (r.result || ""),
      mood: cancelled ? "罢" : info.seal,
      folio,
    };
  }

  function buildFaces() {
    const faces = [];
    const now = new Date();
    const fallbackVolume = {
      key: volumeKey(now.getFullYear(), now.getMonth() + 1, currentPeriod(now)),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      period: currentPeriod(now),
      records: [],
      count: 0,
      isCurrent: true,
      label: `${cnMonth(now.getMonth() + 1)} · 第${cnNum(currentPeriod(now))}册`,
      title: "今日所在册",
    };
    const volume = data.volumes.find((item) => item.key === state.selectedVolumeKey)
      || data.volumes.find((item) => item.isCurrent)
      || data.volumes[0]
      || fallbackVolume;

    faces.push({
      type: "plate",
      title: "回声志",
      sub: "凡所记录，皆成回响",
      epigraph: "一事一记，一日一页。\n所志者非帝王将相，\n乃你亲手度过的每一寸光阴。",
    });

    // 目录页：进行中的任务 + 卷册索引（内容最后回填）
    const tocFace = { type: "toc", active: [], volumes: [] };
    faces.push(tocFace);

    const eraFaceIndex = [];
    let folio = 1;

    if (!data.ok) {
      faces.push({ type: "note", text: "烽燧不通，未能连上 EchoLog 后端。\n请确认 el daemon 已启动，再刷新此页。" });
    } else if (volume.records.length === 0 && !volume.isCurrent) {
      faces.push({ type: "note", text: "此册尚无一记。\n翻回书架，另启一册。" });
    }

    const todayIndex = faces.length;
    eraFaceIndex.push({
      key: volume.key,
      label: volume.label,
      era: volume.label,
      title: volume.title,
      faceIndex: todayIndex,
      today: volume.isCurrent,
      count: volume.count,
    });
    faces.push({
      type: "era",
      era: volume.label,
      year: volume.period == null
        ? `${cnYear(volume.year)}年${cnMonth(volume.month)}`
        : `${cnYear(volume.year)}年${cnMonth(volume.month)}${volume.period === currentPeriod(now) && volume.isCurrentMonth ? " · 今日所在" : ""}`,
      count: volume.count,
      today: volume.isCurrent,
    });

    for (const r of volume.records) faces.push(entryFace(r, folio++));

    if (data.ok && volume.isCurrent) {
      faces.push({ type: "summary" });
      faces.push(...pluginWebHost.faces());
      for (const r of orderHierarchically(data.active)) {
        tocFace.active.push({
          id: r.id,
          title: r.title,
          status: r.status,
          base: r.liveDurationSeconds ?? r.durationSeconds,
          parentId: r.parentId,
          depth: recordDepth(r),
          faceIndex: faces.length,
        });
        faces.push({ type: "active", record: r });
      }
      faces.push({ type: "form" });
    }
    tocFace.volumes = data.volumes.map((item) => ({
      key: item.key,
      label: item.label,
      era: item.isCurrentMonth ? item.label : item.label,
      title: item.title,
      count: item.count,
      today: item.isCurrent,
    }));

    faces.push({
      type: "plate",
      title: "未 完",
      sub: "岁月还长",
      epigraph: "此后诸页，留与将来。\n掩卷之后，去写下一记。",
    });

    if (faces.length % 2 !== 0) faces.push({ type: "blank" });
    return { faces, eraFaceIndex, todayIndex, volumeKey: volume.key };
  }

  /* ============ 渲染一面 ============ */

  function statusMark(status) {
    if (status === "done") return "毕";
    if (status === "running") return "行";
    if (status === "paused") return "憩";
    return "罢";
  }

  function statusText(status) {
    if (status === "done") return "已毕";
    if (status === "running") return "进行中";
    if (status === "paused") return "已暂停";
    return "已作废";
  }

  function renderParentLink(parentId) {
    if (!parentId) return "";
    const parent = recordById(parentId);
    const title = parent ? parent.title : parentId;
    return `<button class="hier-parent" type="button" data-goto-record="${escA(parentId)}">
      <span class="hier-branch">隶</span>
      <span>隶于 ${esc(title)}</span>
    </button>`;
  }

  function renderSubtaskPanel(recordId) {
    const progress = subtaskProgress(recordId);
    const record = recordById(recordId);
    const canAdd = record && record.status !== "cancelled";
    if (progress.total === 0) {
      return canAdd
        ? `<button class="subtask-empty" type="button" data-act="new-child" data-parent-id="${escA(recordId)}">
            <span>尚无支脉</span><span>添一支</span>
          </button>`
        : "";
    }
    const effectiveTotal = progress.total - progress.cancelled;
    const visible = progress.children.slice(0, 4);
    const rows = visible.map((child) =>
      `<button class="subtask-row" type="button" data-goto-record="${escA(child.id)}">
        <span class="subtask-mark ${escA(child.status)}">${statusMark(child.status)}</span>
        <span class="subtask-title">${esc(child.title)}</span>
        <span class="subtask-state">${statusText(child.status)}</span>
      </button>`
    ).join("");
    const rest = progress.total > visible.length
      ? `<div class="subtask-rest">另有 ${progress.total - visible.length} 项，见目录</div>`
      : "";
    return `<section class="subtask-panel" aria-label="直接子任务">
      <div class="subtask-head">
        <span>支 脉</span>
        <span class="subtask-head-actions">
          <span>${progress.done}/${effectiveTotal} · ${progress.percent}%</span>
          ${canAdd ? `<button type="button" data-act="new-child" data-parent-id="${escA(recordId)}">添支</button>` : ""}
        </span>
      </div>
      <div class="subtask-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}">
        <span style="width:${progress.percent}%"></span>
      </div>
      <div class="subtask-list">${rows}${rest}</div>
    </section>`;
  }

  function renderFace(face) {
    const pluginFace = pluginWebHost.renderFace(face, {
      data,
      esc,
      escA,
      fmtDur,
    });
    if (pluginFace != null) return pluginFace;

    if (!face || face.type === "blank") return `<div class="leaf-inner"></div>`;

    if (face.type === "plate") {
      return `<div class="leaf-inner plate">
        <div class="plate-title">${esc(face.title)}</div>
        <div class="era-orn"></div>
        <div class="plate-sub">${esc(face.sub || "")}</div>
        <p class="plate-epigraph">${esc(face.epigraph || "")}</p>
      </div>`;
    }

    if (face.type === "note") {
      return `<div class="leaf-inner note-face"><p class="nf-text">${esc(face.text)}</p></div>`;
    }

    if (face.type === "toc") {
      const act = face.active.map((a) =>
        `<button class="toc-row toc-hier-row${a.parentId ? " is-child" : ""}" type="button" data-goto="${a.faceIndex}" style="--hier-depth:${Math.min(a.depth || 0, 4)}">
          ${a.parentId ? `<span class="toc-branch">└</span>` : ""}
          <span class="toc-state${a.status === "running" ? "" : " paused"}">${a.status === "running" ? "行" : "憩"}</span>
          <span class="toc-name">${esc(a.title)}</span>
          <span class="toc-dots"></span>
          <span class="toc-time" data-timer data-fmt="clock" data-live-id="${escA(a.id)}" data-base="${a.base}" data-fetched="${data.fetchedAt}" data-paused="${a.status === "running" ? 0 : 1}">${esc(fmtTimer(a.base))}</span>
        </button>`).join("");
      const vols = face.volumes.map((v) =>
        `<button class="toc-row${v.key === state.selectedVolumeKey ? " toc-selected" : ""}" type="button" data-volume="${escA(v.key)}">
          <span class="toc-name${v.today ? " toc-today" : ""}">${esc(v.era)}</span>
          <span class="toc-dots"></span>
          <span class="toc-count">${v.count} 记</span>
        </button>`).join("");
      return `<div class="leaf-inner toc-face">
        <div class="toc-title">目 录</div>
        <div class="toc-scroll">
          <div class="toc-section">今在录${face.active.length ? `（${face.active.length} 事）` : ""}</div>
          ${act || `<p class="toc-empty">此刻无事在录。</p>`}
          <div class="toc-section">卷 册</div>
          ${vols}
        </div>
      </div>`;
    }

    if (face.type === "era") {
      return `<div class="leaf-inner era-cover">
        <div class="era-year">${esc(face.year || "")}</div>
        <div class="era-name">${esc(face.era)}</div>
        <div class="era-orn"></div>
        <div class="era-count">${face.today ? `今日已录 ${face.count} 记` : `收录 ${face.count} 记`}</div>
      </div>`;
    }

    if (face.type === "entry") {
      const parentLink = renderParentLink(face.parentId);
      const subtaskPanel = renderSubtaskPanel(face.id);
      const metaBits = [
        `<span>${esc(face.typeLabel)}</span>`,
        face.project ? `<span>${esc(face.project)}</span>` : "",
        `<span class="m-dur">用时 ${esc(fmtDur(face.duration))}</span>`,
        ...face.tags.map((t) => `<span class="entry-tag">${esc(t)}</span>`),
      ].filter(Boolean).join("");
      return `<div class="leaf-inner${face.cancelled ? " entry-cancelled" : ""}${subtaskPanel ? " has-subtasks" : ""}">
        <div class="entry-date">${esc(face.date)}</div>
        ${parentLink}
        <h3 class="entry-title">${esc(face.title)}</h3>
        <div class="entry-rule"></div>
        <div class="entry-meta">${metaBits}</div>
        ${subtaskPanel}
        <div class="entry-text">${face.text ? esc(face.text) : `<span class="no-result">未留一言。</span>`}</div>
        <div class="entry-foot">
          <span class="mood-seal">${esc(face.mood)}</span>
          <span class="folio">第 ${face.folio} 记</span>
        </div>
      </div>`;
    }

    if (face.type === "summary") {
      const s = data.summary || { totalSeconds: 0, recordCount: 0, byType: { learning: 0, project: 0, task: 0 } };
      const running = data.active.some((r) => r.status === "running");
      const now = new Date();
      return `<div class="leaf-inner today-sum">
        <div class="ts-date">${esc(cnMonth(now.getMonth() + 1) + cnNum(now.getDate()) + "日")} · 周${WEEKDAYS[now.getDay()]}</div>
        <div class="ts-total" id="tsTotal" data-timer data-fmt="dur" data-base="${s.totalSeconds}" data-fetched="${data.fetchedAt}" data-paused="${running ? 0 : 1}">${esc(fmtDur(s.totalSeconds))}</div>
        <div class="ts-count" id="tsCount">今日已录 ${s.recordCount} 记</div>
        <div class="ts-types">
          <div class="ts-type t-learning"><span class="t-seal">学</span><span class="t-val" data-ts-type="learning">${esc(fmtDur(s.byType.learning))}</span></div>
          <div class="ts-type t-project"><span class="t-seal">造</span><span class="t-val" data-ts-type="project">${esc(fmtDur(s.byType.project))}</span></div>
          <div class="ts-type t-task"><span class="t-seal">务</span><span class="t-val" data-ts-type="task">${esc(fmtDur(s.byType.task))}</span></div>
        </div>
      </div>`;
    }

    if (face.type === "active") {
      const r = face.record;
      const parentLink = renderParentLink(r.parentId);
      const subtaskPanel = renderSubtaskPanel(r.id);
      const info = typeInfo(r.type);
      const running = r.status === "running";
      const started = new Date(r.startAt);
      const base = r.liveDurationSeconds ?? r.durationSeconds;
      const metaBits = [
        `<span>${esc(info.label)}</span>`,
        r.project ? `<span>${esc(r.project)}</span>` : "",
        ...(r.tags || []).map((t) => `<span class="entry-tag">${esc(t)}</span>`),
      ].filter(Boolean).join("");
      const seals = running
        ? `<button class="seal-btn s-calm" type="button" data-act="pause" data-id="${escA(r.id)}"><span class="s-face">憩</span><span class="s-label">暂停</span></button>`
        : `<button class="seal-btn s-gold" type="button" data-act="resume" data-id="${escA(r.id)}"><span class="s-face">续</span><span class="s-label">继续</span></button>`;
      return `<div class="leaf-inner live-entry${subtaskPanel ? " has-subtasks" : ""}" data-record-id="${escA(r.id)}">
        <div class="entry-date">
          <span>始于 ${esc(fmtClockHM(started))}</span>
          <span class="live-state${running ? "" : " paused"}">${running ? "行 · 进行中" : "憩 · 已暂停"}</span>
        </div>
        ${parentLink}
        <h3 class="entry-title">${esc(r.title)}</h3>
        <div class="entry-rule"></div>
        <div class="entry-meta">${metaBits}</div>
        ${subtaskPanel}
        <div class="live-timer${running ? "" : " paused"}" data-timer data-fmt="clock" data-live-id="${escA(r.id)}" data-base="${base}" data-fetched="${data.fetchedAt}" data-paused="${running ? 0 : 1}">${esc(fmtTimer(base))}</div>
        <div class="live-since">笔未搁，事未毕</div>
        <div class="result-row">
          <input class="result-input" type="text" placeholder="一句话结果（收笔时随印落下，可空）" data-result-for="${escA(r.id)}" />
        </div>
        <div class="seal-row">
          ${seals}
          <button class="seal-btn" type="button" data-act="stop" data-id="${escA(r.id)}"><span class="s-face">毕</span><span class="s-label">收笔</span></button>
          <button class="seal-btn s-ghost" type="button" data-act="cancel" data-id="${escA(r.id)}"><span class="s-face">罢</span><span class="s-label">作废</span></button>
        </div>
      </div>`;
    }

    if (face.type === "form") {
      const chip = (t, label) =>
        `<button class="type-chip${formType === t ? " on" : ""}" type="button" data-type="${t}">${label}</button>`;
      const parentOptions = [...data.records]
        .filter((r) => r.status !== "cancelled")
        .sort((a, b) => {
          const activeA = a.status === "running" || a.status === "paused" ? 1 : 0;
          const activeB = b.status === "running" || b.status === "paused" ? 1 : 0;
          return activeB - activeA || new Date(b.startAt) - new Date(a.startAt);
        })
        .map((r) => {
          const branch = recordDepth(r) > 0 ? `${"· ".repeat(Math.min(recordDepth(r), 3))}` : "";
          return `<option value="${escA(r.id)}"${r.id === formParentId ? " selected" : ""}>${esc(`${branch}${r.title}［${statusMark(r.status)}］`)}</option>`;
        })
        .join("");
      return `<div class="leaf-inner new-form">
        <div class="form-title">始一事</div>
        <div class="form-hint">落笔即开始计时</div>
        <div class="form-field">
          <label class="form-label">何 事</label>
          <input class="form-input" type="text" id="nfTitle" placeholder="如：读《史记》三十页" />
        </div>
        <div class="form-field">
          <label class="form-label">何 类</label>
          <div class="type-chips">
            ${chip("learning", "学习")}
            ${chip("project", "项目")}
            ${chip("task", "任务")}
          </div>
        </div>
        <div class="form-pair">
          <div class="form-field">
            <label class="form-label">何 门</label>
            <input class="form-input" type="text" id="nfProject" placeholder="所属项目，可空" />
          </div>
          <div class="form-field">
            <label class="form-label">何 属</label>
            <select class="form-input form-select" id="nfParent" aria-label="父任务">
              <option value=""${formParentId ? "" : " selected"}>根任务 · 无所隶</option>
              ${parentOptions}
            </select>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">何 签</label>
          <input class="form-input" type="text" id="nfTags" placeholder="标签，逗号分隔，可空" />
        </div>
        <div class="form-error" id="nfError"></div>
        <div class="form-actions">
          <button class="seal-btn" type="button" data-act="start"><span class="s-face">始</span><span class="s-label">开始</span></button>
        </div>
      </div>`;
    }

    return `<div class="leaf-inner"></div>`;
  }

  /* ============ 书本状态 ============ */

  const state = {
    faces: [],
    eraFaceIndex: [],
    todayIndex: 0,
    sheets: new Map(),
    sheetCount: 0,
    flipped: 0,
    signature: "",
    selectedVolumeKey: "",
    historyRefreshPending: false,
    opened: false,
  };

  const SHEET_WINDOW_BEFORE = 2;
  const SHEET_WINDOW_AFTER = 3;

  const faceToFlip = (faceIndex) => Math.floor(faceIndex / 2) + (faceIndex % 2);

  function buildBook(keepPosition) {
    const prevFlipped = state.flipped;
    const previousVolumeKey = state.selectedVolumeKey;
    const { faces, eraFaceIndex, todayIndex, volumeKey: builtVolumeKey } = buildFaces();
    state.faces = faces;
    state.eraFaceIndex = eraFaceIndex;
    state.todayIndex = todayIndex;
    state.selectedVolumeKey = builtVolumeKey;
    state.signature = liveSignature();

    const pagesEl = $("pages");
    pagesEl.classList.add("no-anim");
    pagesEl.innerHTML = "";
    state.sheets = new Map();

    state.sheetCount = faces.length / 2;
    const sameVolume = previousVolumeKey === builtVolumeKey;
    state.flipped = keepPosition && sameVolume ? Math.min(prevFlipped, state.sheetCount) : 0;

    // Chrome 对 preserve-3d 中翻转背面的按钮命中不稳定。左页保留真实内容，
    // 另用一个平面、透明的同构层接收按钮点击，再转发给真实可见按钮。
    const leftHitProxy = document.createElement("div");
    leftHitProxy.id = "leftPageHitProxy";
    leftHitProxy.className = "left-page-hit-proxy";
    leftHitProxy.setAttribute("aria-hidden", "true");
    pagesEl.appendChild(leftHitProxy);

    ensureSheetWindow(state.flipped);
    layoutSheets();
    buildTimeline();
    updateIndicator();
    state.rulesJson = JSON.stringify(data.rules);
    $("liveDot").hidden = data.active.length === 0;

    requestAnimationFrame(() => requestAnimationFrame(() => pagesEl.classList.remove("no-anim")));
  }

  function createSheet(index) {
    if (index < 0 || index >= state.sheetCount || state.sheets.has(index)) return;
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.dataset.sheetIndex = String(index);
    sheet.innerHTML =
      `<div class="leaf front">${renderFace(state.faces[index * 2])}</div>` +
      `<div class="leaf back">${renderFace(state.faces[index * 2 + 1])}</div>`;
    const proxy = $("leftPageHitProxy");
    $("pages").insertBefore(sheet, proxy);
    state.sheets.set(index, sheet);
  }

  function ensureSheetWindow(center) {
    const start = Math.max(0, center - SHEET_WINDOW_BEFORE);
    const end = Math.min(state.sheetCount - 1, center + SHEET_WINDOW_AFTER);
    for (let index = start; index <= end; index++) createSheet(index);
  }

  function trimSheetWindow(center) {
    const start = Math.max(0, center - SHEET_WINDOW_BEFORE);
    const end = Math.min(state.sheetCount - 1, center + SHEET_WINDOW_AFTER);
    for (const [index, sheet] of state.sheets) {
      if (index >= start && index <= end) continue;
      sheet.remove();
      state.sheets.delete(index);
    }
    layoutSheets();
  }

  function visibleLeftLeaf() {
    return state.flipped > 0 ? state.sheets.get(state.flipped - 1)?.children[1] : null;
  }

  function syncLeftHitProxy() {
    const proxy = $("leftPageHitProxy");
    const source = visibleLeftLeaf();
    if (!proxy) return;

    proxy.hidden = !source;
    proxy.innerHTML = source ? source.innerHTML : "";
    if (!source) return;

    // 克隆层只负责鼠标/触控命中，不能制造重复 id 或进入键盘焦点序列。
    proxy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    proxy.querySelectorAll("input, textarea, select").forEach((el) => {
      el.removeAttribute("name");
      el.tabIndex = -1;
    });

    const sourceButtons = source.querySelectorAll("button");
    proxy.querySelectorAll("button").forEach((button, index) => {
      button.dataset.hitSourceIndex = String(index);
      button.tabIndex = -1;
      button.disabled = sourceButtons[index]?.disabled ?? true;
    });
  }

  // 维持正确堆叠：preserve-3d 下由真实 Z 值决定，每张 Z 必须唯一
  function layoutSheets() {
    for (const [index, sheet] of state.sheets) {
      const frontActive = index === state.flipped && index < state.sheetCount;
      const backActive = index === state.flipped - 1;
      sheet.classList.toggle("flipped", index < state.flipped);
      sheet.classList.toggle("page-right-active", frontActive);
      sheet.classList.toggle("page-left-active", backActive);
      sheet.style.zIndex = index < state.flipped ? String(index + 1) : String(state.sheetCount - index);
      const depth = index < state.flipped ? (state.flipped - index) : (index - state.flipped);
      const dz = -depth * 0.55;
      const front = sheet.children[0];
      const back = sheet.children[1];
      front.style.transform = `translateZ(${dz}px)`;
      back.style.transform = `rotateY(180deg) translateZ(${dz}px)`;
      front.inert = !frontActive;
      back.inert = !backActive;
      front.setAttribute("aria-hidden", String(!frontActive));
      back.setAttribute("aria-hidden", String(!backActive));
    }
    syncLeftHitProxy();
  }

  function flipTo(target) {
    const n = state.sheetCount;
    const clamped = Math.max(0, Math.min(n, target));
    if (clamped === state.flipped) return;
    ensureSheetWindow(clamped);
    state.flipped = clamped;
    layoutSheets();
    updateIndicator();
    window.setTimeout(() => trimSheetWindow(state.flipped), 1100);
  }

  const next = () => flipTo(state.flipped + 1);
  const prev = () => flipTo(state.flipped - 1);
  const currentVolume = () => data.volumes.find((volume) => volume.isCurrent) || null;
  const selectedVolume = () => data.volumes.find((volume) => volume.key === state.selectedVolumeKey) || null;
  const gotoToday = () => {
    const current = currentVolume();
    if (current && selectedVolume()?.key !== current.key) {
      selectVolume(current.key);
      return;
    }
    flipTo(faceToFlip(state.todayIndex));
  };
  // 直达今日的「总览 + 进行中」对开页
  const gotoLive = () => {
    const current = currentVolume();
    if (current && selectedVolume()?.key !== current.key) {
      selectVolume(current.key);
      window.setTimeout(() => flipTo(faceToFlip(state.todayIndex + (data.ok ? 1 : 0))), 0);
      return;
    }
    flipTo(faceToFlip(state.todayIndex + (data.ok ? 1 : 0)));
  };

  function updateIndicator() {
    const n = state.sheetCount;
    const volume = selectedVolume();
    $("pageIndicator").textContent = `${volume ? volume.label : "回声志"} · ${state.flipped} / ${n} 张`;
    $("prevBtn").disabled = state.flipped === 0;
    $("nextBtn").disabled = state.flipped === n;
    document.querySelectorAll(".tl-node").forEach((node) => {
      node.classList.toggle("active", node.dataset.volumeKey === state.selectedVolumeKey);
    });
  }

  /* ============ 时间轴 ============ */

  function buildTimeline() {
    const tl = $("timeline");
    tl.innerHTML = "";
    data.volumes.forEach((volume) => {
      const btn = document.createElement("button");
      btn.className = "tl-node" + (volume.isCurrent ? " tl-today" : "");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.volumeKey = volume.key;
      btn.setAttribute("aria-selected", String(volume.key === state.selectedVolumeKey));
      btn.textContent = volume.label;
      btn.title = `${volume.title} · ${volume.count} 记`;
      btn.addEventListener("click", () => selectVolume(volume.key));
      tl.appendChild(btn);
    });
  }

  function selectVolume(key) {
    if (!data.volumes.some((volume) => volume.key === key)) return;
    if (state.selectedVolumeKey === key && state.faces.length) return;
    state.selectedVolumeKey = key;
    buildBook(false);
  }

  /* ============ 提示条 ============ */

  function flash(msg) {
    const el = document.createElement("div");
    el.className = "flash";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("gone"), 2200);
    setTimeout(() => el.remove(), 3000);
  }

  /* ============ 任务操作 ============ */

  let formType = "task";
  let formParentId = "";

  function isEditing() {
    const el = document.activeElement;
    return !!(el && el.closest && el.closest("#pages") && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }

  async function refreshBook({ jumpToFace } = {}) {
    try {
      await loadAll();
    } catch (err) {
      flash(`取数失败：${err.message}`);
      return;
    }
    buildBook(true);
    if (jumpToFace != null) flipTo(faceToFlip(jumpToFace));
  }

  async function doAction(btn) {
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    btn.disabled = true;
    try {
      const pluginResult = await pluginWebHost.handleAction(act, {
        id,
        $,
        confirm: (message) => window.confirm(message),
      });
      if (pluginResult.handled) {
        if (pluginResult.message) flash(pluginResult.message);
        if (pluginResult.refresh !== false) await refreshBook({});
        else btn.disabled = false;
        return;
      }
      if (act === "pause") {
        await patchReq(`/records/${id}`, { action: "pause" });
        flash("已暂停 · 憩");
      } else if (act === "resume") {
        await patchReq(`/records/${id}`, { action: "resume" });
        flash("已继续 · 行");
      } else if (act === "stop") {
        const input = document.querySelector(`.result-input[data-result-for="${CSS.escape(id)}"]`);
        const result = input && input.value.trim() ? input.value.trim() : undefined;
        await patchReq(`/records/${id}`, { action: "stop", result });
        flash("已收笔，此事载入史册 · 毕");
      } else if (act === "cancel") {
        await del(`/records/${id}`);
        flash("已作废 · 罢");
      } else if (act === "new-child") {
        formParentId = btn.dataset.parentId || "";
        const parentSelect = $("nfParent");
        if (parentSelect) parentSelect.value = formParentId;
        const formIndex = state.faces.findIndex((face) => face.type === "form");
        if (formIndex >= 0) flipTo(faceToFlip(formIndex));
        btn.disabled = false;
        return;
      } else if (act === "start") {
        const title = ($("nfTitle") ? $("nfTitle").value : "").trim();
        const errEl = $("nfError");
        if (!title) {
          if (errEl) errEl.textContent = "何事未书，不可开卷。";
          btn.disabled = false;
          return;
        }
        const project = ($("nfProject") ? $("nfProject").value : "").trim();
        const parentId = ($("nfParent") ? $("nfParent").value : "").trim();
        const tags = ($("nfTags") ? $("nfTags").value : "")
          .split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        const created = await post("/records", {
          title,
          type: formType,
          project: project || undefined,
          parentId: parentId || undefined,
          tags: tags.length ? tags : undefined,
          source: "web",
        });
        formParentId = "";
        flash("落笔 · 始");
        await refreshBook();
        // 翻到新任务那一面
        const idx = state.faces.findIndex((f) => f.type === "active" && f.record.id === created.id);
        if (idx >= 0) flipTo(faceToFlip(idx));
        return;
      }
      await refreshBook();
    } catch (err) {
      flash(`操作失败：${err.message}`);
      btn.disabled = false;
    }
  }

  function setupActions() {
    const pages = $("pages");

    pages.addEventListener("click", (e) => {
      const hitProxy = e.target.closest("[data-hit-source-index]");
      if (hitProxy) {
        const sourceButtons = visibleLeftLeaf()?.querySelectorAll("button");
        const sourceButton = sourceButtons?.[Number(hitProxy.dataset.hitSourceIndex)];
        if (sourceButton && !sourceButton.disabled) sourceButton.click();
        return;
      }

      const recordGoto = e.target.closest("[data-goto-record]");
      if (recordGoto) {
        const id = recordGoto.dataset.gotoRecord;
        let idx = state.faces.findIndex((face) =>
          (face.type === "entry" && face.id === id) ||
          (face.type === "active" && face.record.id === id)
        );
        if (idx >= 0) {
          flipTo(faceToFlip(idx));
          return;
        }
        const targetVolume = data.volumes.find((volume) =>
          volume.records.some((record) => record.id === id)
        ) || (data.active.some((record) => record.id === id) ? currentVolume() : null);
        if (!targetVolume) {
          flash("此记录不在当前卷中");
          return;
        }
        selectVolume(targetVolume.key);
        window.setTimeout(() => {
          idx = state.faces.findIndex((face) =>
            (face.type === "entry" && face.id === id) ||
            (face.type === "active" && face.record.id === id)
          );
          if (idx >= 0) flipTo(faceToFlip(idx));
        }, 0);
        return;
      }
      const volumeGoto = e.target.closest("[data-volume]");
      if (volumeGoto) {
        selectVolume(volumeGoto.dataset.volume);
        return;
      }
      const goto = e.target.closest("[data-goto]");
      if (goto) {
        flipTo(faceToFlip(Number(goto.dataset.goto)));
        return;
      }
      const chip = e.target.closest(".type-chip");
      if (chip) {
        formType = chip.dataset.type;
        pages.querySelectorAll(".type-chip").forEach((c) => c.classList.toggle("on", c === chip));
        return;
      }
      const btn = e.target.closest("[data-act]");
      if (btn) doAction(btn);
    });

    pages.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (t.matches && t.matches(".result-input")) {
        const stopBtn = pages.querySelector(`[data-act="stop"][data-id="${CSS.escape(t.dataset.resultFor)}"]`);
        if (stopBtn) doAction(stopBtn);
      } else if (t.closest && t.closest(".rule-form")) {
        const addBtn = pages.querySelector(`[data-act="add-rule"]`);
        if (addBtn) doAction(addBtn);
      } else if (t.matches && t.matches("input.form-input")) {
        const startBtn = pages.querySelector(`[data-act="start"]`);
        if (startBtn) doAction(startBtn);
      }
    });

    pages.addEventListener("change", (e) => {
      if (e.target && e.target.id === "nfParent") {
        formParentId = e.target.value;
      }
    });
  }

  /* ============ 计时与轮询 ============ */

  function tickTimers() {
    const now = Date.now();
    document.querySelectorAll("[data-timer]").forEach((el) => {
      const base = Number(el.dataset.base) || 0;
      const paused = el.dataset.paused === "1";
      const fetched = Number(el.dataset.fetched) || now;
      const val = paused ? base : base + (now - fetched) / 1000;
      el.textContent = el.dataset.fmt === "dur" ? fmtDur(val) : fmtTimer(val);
    });
  }

  function patchLiveDom() {
    // 不重排整本书，仅刷新计时基准与今日数字（正文页 + 目录页）
    for (const r of data.active) {
      document.querySelectorAll(`[data-timer][data-live-id="${CSS.escape(r.id)}"]`).forEach((timer) => {
        timer.dataset.base = String(r.liveDurationSeconds ?? r.durationSeconds);
        timer.dataset.fetched = String(data.fetchedAt);
        timer.dataset.paused = r.status === "running" ? "0" : "1";
      });
    }
    const s = data.summary;
    if (s) {
      const total = $("tsTotal");
      if (total) {
        total.dataset.base = String(s.totalSeconds);
        total.dataset.fetched = String(data.fetchedAt);
        total.dataset.paused = data.active.some((r) => r.status === "running") ? "0" : "1";
      }
      const count = $("tsCount");
      if (count) count.textContent = `今日已录 ${s.recordCount} 记`;
      document.querySelectorAll("[data-ts-type]").forEach((el) => {
        el.textContent = fmtDur(s.byType[el.dataset.tsType] || 0);
      });
    }
    $("liveDot").hidden = data.active.length === 0;
    // 屏中光阴页原地重渲（页内无输入态，安全；保留滚动位置）
    document.querySelectorAll(".screen-face").forEach((el) => {
      const scroll = el.querySelector(".toc-scroll");
      const top = scroll ? scroll.scrollTop : 0;
      el.outerHTML = renderFace({ type: "screen" });
      const ns = document.querySelector(".screen-face .toc-scroll");
      if (ns) ns.scrollTop = top;
    });
    // 立例页仅在规则集变化且不在输入时重渲（页内有表单）
    const rulesJson = JSON.stringify(data.rules);
    if (rulesJson !== state.rulesJson && !isEditing()) {
      document.querySelectorAll(".rules-face").forEach((el) => {
        el.outerHTML = renderFace({ type: "rules" });
      });
      state.rulesJson = rulesJson;
    }
    tickTimers();
  }

  function startLoops() {
    setInterval(tickTimers, 1000);
    setInterval(async () => {
      if (!data.ok) return;
      const previousRecordCount = data.summary ? data.summary.recordCount : null;
      const previousLatestRecordKey = data.latestRecordKey;
      try {
        await loadLive();
      } catch {
        return; // 后端暂时不可达，静默
      }
      const historyChanged = previousRecordCount !== data.summary?.recordCount
        || previousLatestRecordKey !== data.latestRecordKey;
      if (historyChanged) state.historyRefreshPending = true;

      if (state.historyRefreshPending) {
        if (isEditing()) return;
        try { await loadAll(); } catch { return; }
        state.historyRefreshPending = false;
        buildBook(true);
        return;
      }

      if (liveSignature() !== state.signature) {
        // 活动任务状态变化只重建当前书；历史书无需触碰 DOM。
        if (isEditing()) return;
        if (selectedVolume()?.isCurrent) buildBook(true);
        else state.signature = liveSignature();
      }
      patchLiveDom();
    }, 5000);
  }

  /* ============ 视差环视 ============ */

  function setupParallax() {
    const book = $("book");
    let raf = 0;
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        book.style.setProperty("--tiltY", `${nx * 14}deg`);
        book.style.setProperty("--tiltX", `${8 - ny * 10}deg`);
      });
    });
  }

  /* ============ 输入：键盘 / 滚轮 / 拖拽 ============ */

  const INTERACTIVE = "input, textarea, select, button, .entry-text, .toc-scroll, .new-form, .live-entry.has-subtasks";

  function setupInput() {
    // 事件委托让控制按钮不受 3D 书页重排影响；controls 位于 book-scene
    // 之后，但仍显式阻止默认行为，避免点击被拖拽/翻页手势吞掉。
    $("pageControls").addEventListener("click", (e) => {
      const btn = e.target instanceof Element ? e.target.closest("[data-nav]") : null;
      if (!btn || btn.disabled) return;
      e.preventDefault();
      btn.dataset.nav === "prev" ? prev() : next();
    });

    window.addEventListener("keydown", (e) => {
      if ($("stage").hidden) return;
      const t = e.target;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
      if (e.key === "Home") flipTo(0);
      if (e.key === "End") gotoLive();
    });

    // 滚轮翻页（节流）
    let wheelLock = 0;
    window.addEventListener("wheel", (e) => {
      if ($("stage").hidden) return;
      if (e.target.closest(INTERACTIVE)) return;
      const now = Date.now();
      if (now - wheelLock < 650) return;
      if (Math.abs(e.deltaY) < 12 && Math.abs(e.deltaX) < 12) return;
      wheelLock = now;
      (e.deltaY > 0 || e.deltaX > 0) ? next() : prev();
    }, { passive: true });

    // 拖拽翻页
    let dragStartX = null;
    const scene = $("bookScene");
    scene.addEventListener("pointerdown", (e) => {
      if (e.target.closest(INTERACTIVE)) return;
      dragStartX = e.clientX;
    });
    window.addEventListener("pointerup", (e) => {
      if (dragStartX === null) return;
      const dx = e.clientX - dragStartX;
      dragStartX = null;
      if (Math.abs(dx) < 50) return;
      dx < 0 ? next() : prev();
    });
  }

  /* ============ 尘埃粒子 ============ */

  function setupDust() {
    const canvas = $("dust");
    const ctx = canvas.getContext("2d");
    let particles = [];
    let w, h;

    function resize() {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const count = Math.min(90, Math.floor((window.innerWidth * window.innerHeight) / 16000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.6 + 0.4) * devicePixelRatio,
        vx: (Math.random() - 0.5) * 0.12 * devicePixelRatio,
        vy: (-Math.random() * 0.18 - 0.03) * devicePixelRatio,
        a: Math.random() * 0.5 + 0.1,
        tw: Math.random() * Math.PI * 2,
      }));
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.tw += 0.015;
        if (p.y < -10 || p.x < -10 || p.x > w + 10) {
          p.x = Math.random() * w;
          p.y = h + 10;
        }
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214, 190, 140, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
      requestAnimationFrame(tick);
    }

    window.addEventListener("resize", resize);
    resize();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) tick();
  }

  /* ============ 启动 ============ */

  async function init() {
    setupParallax();
    setupInput();
    setupActions();
    setupDust();

    const loading = loadAll().catch(() => { data.ok = false; });

    $("openBook").addEventListener("click", async () => {
      await loading;
      buildBook(false);
      startLoops();
      // 先确定可见页，再展示舞台；不让用户在开卷动画期间看到一个
      // 仍停在第 0 页、因此被 disabled 的左侧按钮。
      const h = location.hash;
      if (h === "#today") gotoLive();
      else if (h === "#screen" || h === "#rules") {
        const idx = state.faces.findIndex((f) => f.type === h.slice(1));
        flipTo(idx >= 0 ? faceToFlip(idx) : 1);
      } else {
        flipTo(1);
      }
      $("prologue").classList.add("gone");
      $("stage").hidden = false;
      state.opened = true;
    });

    // 深链：/#open、/#toc 直达目录；/#today 今日总览；/#screen 屏中光阴；/#rules 立例
    if (["#open", "#toc", "#today", "#screen", "#rules"].includes(location.hash)) {
      $("openBook").click();
    }
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
