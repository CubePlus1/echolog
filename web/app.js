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
    history: [],   // done/cancelled 记录，升序
    active: [],    // running/paused（enriched）
    summary: null, // 今日总览
    screen: null,  // 今日屏幕使用（/api/screen/today）
    rules: [],     // 分类规则
    fetchedAt: 0,  // active/summary 抓取时刻（本地毫秒）
    ok: false,     // 是否成功连上后端
  };

  async function loadAll() {
    const [records, active, summary, screen, rules] = await Promise.all([
      api("/records?limit=1000"),
      api("/records/active"),
      api("/summary/today"),
      api("/screen/today").catch(() => null),
      api("/screen/rules").catch(() => []),
    ]);
    data.history = records
      .filter((r) => r.status === "done" || r.status === "cancelled")
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    data.active = active;
    data.summary = summary;
    data.screen = screen;
    data.rules = rules;
    data.fetchedAt = Date.now();
    data.ok = true;
  }

  async function loadLive() {
    const [active, summary, screen, rules] = await Promise.all([
      api("/records/active"),
      api("/summary/today"),
      api("/screen/today").catch(() => data.screen),
      api("/screen/rules").catch(() => data.rules),
    ]);
    data.active = active;
    data.summary = summary;
    data.screen = screen;
    data.rules = rules;
    data.fetchedAt = Date.now();
  }

  // 活动集签名：变了才整本重排
  function liveSignature() {
    return JSON.stringify([
      data.active.map((r) => [r.id, r.status, r.title, r.project, r.tags]),
      data.summary ? data.summary.recordCount : 0,
    ]);
  }

  /* ============ 数据 → 页面序列 ============ */

  function historyVolumes() {
    const byMonth = new Map(); // "YYYY-MM" -> records
    for (const r of data.history) {
      const d = new Date(r.startAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(r);
    }
    return [...byMonth.entries()].map(([key, records]) => {
      const [y, m] = key.split("-").map(Number);
      return { y, m, records };
    });
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
    faces.push({
      type: "plate",
      title: "回声志",
      sub: "凡所记录，皆成回响",
      epigraph: "一事一记，一日一页。\n所志者非帝王将相，\n乃你亲手度过的每一寸光阴。",
    });

    // 目录页：进行中的任务 + 卷册索引（内容最后回填）
    const tocFace = { type: "toc", active: [], volumes: [] };
    faces.push(tocFace);

    const eraFaceIndex = []; // 时间轴节点
    let folio = 1;

    if (!data.ok) {
      faces.push({ type: "note", text: "烽燧不通，未能连上 EchoLog 后端。\n请确认 el daemon 已启动，再刷新此页。" });
    } else if (data.history.length === 0) {
      faces.push({ type: "note", text: "书尚无一记。\n翻至书末「今日」，落下第一笔。" });
    }

    let volNo = 1;
    for (const vol of historyVolumes()) {
      const era = `卷${cnNum(volNo)} · ${cnMonth(vol.m)}`;
      eraFaceIndex.push({ label: cnMonth(vol.m), era, title: `${era}（${cnYear(vol.y)}年）`, faceIndex: faces.length, count: vol.records.length });
      faces.push({ type: "era", era, year: `${cnYear(vol.y)}年`, count: vol.records.length });
      for (const r of vol.records) faces.push(entryFace(r, folio++));
      volNo++;
    }

    // ---- 今日 · 此刻 ----
    const now = new Date();
    const todayIndex = faces.length;
    eraFaceIndex.push({ label: "今日", era: "今日 · 此刻", title: "今日 · 此刻", faceIndex: todayIndex, today: true, count: data.summary ? data.summary.recordCount : 0 });
    faces.push({
      type: "era",
      era: "今日 · 此刻",
      year: `${cnYear(now.getFullYear())}年${cnMonth(now.getMonth() + 1)}${cnNum(now.getDate())}日`,
      count: data.summary ? data.summary.recordCount : 0,
      today: true,
    });
    if (data.ok) {
      faces.push({ type: "summary" });
      faces.push({ type: "screen" });
      faces.push({ type: "rules" });
      for (const r of data.active) {
        tocFace.active.push({
          id: r.id,
          title: r.title,
          status: r.status,
          base: r.liveDurationSeconds ?? r.durationSeconds,
          faceIndex: faces.length,
        });
        faces.push({ type: "active", record: r });
      }
      faces.push({ type: "form" });
    }
    tocFace.volumes = eraFaceIndex;

    faces.push({
      type: "plate",
      title: "未 完",
      sub: "岁月还长",
      epigraph: "此后诸页，留与将来。\n掩卷之后，去写下一记。",
    });

    if (faces.length % 2 !== 0) faces.push({ type: "blank" });
    return { faces, eraFaceIndex, todayIndex };
  }

  /* ============ 渲染一面 ============ */

  function renderFace(face) {
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
        `<button class="toc-row" type="button" data-goto="${a.faceIndex}">
          <span class="toc-state${a.status === "running" ? "" : " paused"}">${a.status === "running" ? "行" : "憩"}</span>
          <span class="toc-name">${esc(a.title)}</span>
          <span class="toc-dots"></span>
          <span class="toc-time" data-timer data-fmt="clock" data-live-id="${escA(a.id)}" data-base="${a.base}" data-fetched="${data.fetchedAt}" data-paused="${a.status === "running" ? 0 : 1}">${esc(fmtTimer(a.base))}</span>
        </button>`).join("");
      const vols = face.volumes.map((v) =>
        `<button class="toc-row" type="button" data-goto="${v.faceIndex}">
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
      const metaBits = [
        `<span>${esc(face.typeLabel)}</span>`,
        face.project ? `<span>${esc(face.project)}</span>` : "",
        `<span class="m-dur">用时 ${esc(fmtDur(face.duration))}</span>`,
        ...face.tags.map((t) => `<span class="entry-tag">${esc(t)}</span>`),
      ].filter(Boolean).join("");
      return `<div class="leaf-inner${face.cancelled ? " entry-cancelled" : ""}">
        <div class="entry-date">${esc(face.date)}</div>
        <h3 class="entry-title">${esc(face.title)}</h3>
        <div class="entry-rule"></div>
        <div class="entry-meta">${metaBits}</div>
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

    if (face.type === "screen") {
      const sc = data.screen;
      let body;
      if (!sc || sc.totalSeconds === 0) {
        body = `<p class="toc-empty">屏中尚无光阴，或采样器未启。</p>`;
      } else {
        const labelOrder = sc.byLabel.map((b) => b.label);
        const sections = labelOrder.map((label) => {
          const labelTotal = sc.byLabel.find((b) => b.label === label).seconds;
          const apps = sc.apps
            .filter((a) => a.byLabel[label])
            .sort((a, b) => b.byLabel[label] - a.byLabel[label]);
          const top = apps.slice(0, 6);
          const restSec = apps.slice(6).reduce((s, a) => s + a.byLabel[label], 0);
          const rows = top.map((a) =>
            `<div class="toc-row scr-row">
              <span class="toc-name">${esc(a.appName)}</span>
              <span class="toc-dots"></span>
              <span class="toc-time">${esc(fmtDur(a.byLabel[label]))}</span>
            </div>`).join("");
          const rest = restSec > 0
            ? `<div class="toc-row scr-row"><span class="toc-name scr-rest">其余 ${apps.length - 6} 应用</span><span class="toc-dots"></span><span class="toc-time">${esc(fmtDur(restSec))}</span></div>`
            : "";
          return `<div class="toc-section">${esc(label)} · ${esc(fmtDur(labelTotal))}</div>${rows}${rest}`;
        }).join("");
        body = sections;
      }
      return `<div class="leaf-inner toc-face screen-face">
        <div class="toc-title">屏中光阴</div>
        <div class="scr-total">今日在屏 ${esc(sc ? fmtDur(sc.totalSeconds) : "—")}</div>
        <div class="toc-scroll" id="screenScroll">${body}</div>
      </div>`;
    }

    if (face.type === "rules") {
      const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const rows = data.rules.map((r) =>
        `<div class="toc-row rule-row">
          <span class="rule-when">${r.startMinute != null ? `${fmtMin(r.startMinute)}–${fmtMin(r.endMinute)}` : "全天"}</span>
          <span class="toc-name">${esc(r.appMatch)}</span>
          <span class="toc-dots"></span>
          <span class="rule-label">${esc(r.label)}</span>
          <button class="rule-del" type="button" data-act="del-rule" data-id="${escA(r.id)}" title="废除此例">✕</button>
        </div>`).join("");
      return `<div class="leaf-inner toc-face rules-face">
        <div class="toc-title">立 例</div>
        <div class="form-hint">同一应用，何时何名——如 04:00–06:00 的微信为「工作」，其余为「生活」</div>
        <div class="toc-scroll">
          ${rows || `<p class="toc-empty">尚未立例，屏中光阴皆「未分」。</p>`}
        </div>
        <div class="rule-form">
          <div class="rule-form-grid">
            <input class="form-input" type="text" id="rlApp" placeholder="何应用（如 微信）" />
            <input class="form-input" type="text" id="rlLabel" placeholder="何名（如 工作）" />
            <input class="form-input" type="text" id="rlStart" placeholder="何时 04:00（可空）" />
            <input class="form-input" type="text" id="rlEnd" placeholder="何讫 06:00（可空）" />
          </div>
          <div class="form-error" id="rlError"></div>
          <div class="rule-form-foot">
            <span class="form-hint" style="margin:0">带时段者自动优先于全天例</span>
            <button class="seal-btn" type="button" data-act="add-rule"><span class="s-face">立</span><span class="s-label">立例</span></button>
          </div>
        </div>
      </div>`;
    }

    if (face.type === "active") {
      const r = face.record;
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
      return `<div class="leaf-inner live-entry" data-record-id="${escA(r.id)}">
        <div class="entry-date">
          <span>始于 ${esc(fmtClockHM(started))}</span>
          <span class="live-state${running ? "" : " paused"}">${running ? "行 · 进行中" : "憩 · 已暂停"}</span>
        </div>
        <h3 class="entry-title">${esc(r.title)}</h3>
        <div class="entry-rule"></div>
        <div class="entry-meta">${metaBits}</div>
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
        <div class="form-field">
          <label class="form-label">何 门</label>
          <input class="form-input" type="text" id="nfProject" placeholder="所属项目，可空" />
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
    sheets: [],
    flipped: 0,
    signature: "",
    opened: false,
  };

  const faceToFlip = (faceIndex) => Math.floor(faceIndex / 2) + (faceIndex % 2);

  function buildBook(keepPosition) {
    const prevFlipped = state.flipped;
    const { faces, eraFaceIndex, todayIndex } = buildFaces();
    state.faces = faces;
    state.eraFaceIndex = eraFaceIndex;
    state.todayIndex = todayIndex;
    state.signature = liveSignature();

    const pagesEl = $("pages");
    pagesEl.classList.add("no-anim");
    pagesEl.innerHTML = "";
    state.sheets = [];

    const sheetCount = faces.length / 2;
    state.flipped = keepPosition ? Math.min(prevFlipped, sheetCount) : 0;

    for (let i = 0; i < sheetCount; i++) {
      const sheet = document.createElement("div");
      sheet.className = "sheet";
      sheet.innerHTML =
        `<div class="leaf front">${renderFace(faces[i * 2])}</div>` +
        `<div class="leaf back">${renderFace(faces[i * 2 + 1])}</div>`;
      pagesEl.appendChild(sheet);
      state.sheets.push(sheet);
    }
    layoutSheets();
    buildTimeline();
    updateIndicator();
    state.rulesJson = JSON.stringify(data.rules);
    $("liveDot").hidden = data.active.length === 0;

    requestAnimationFrame(() => requestAnimationFrame(() => pagesEl.classList.remove("no-anim")));
  }

  // 维持正确堆叠：preserve-3d 下由真实 Z 值决定，每张 Z 必须唯一
  function layoutSheets() {
    const n = state.sheets.length;
    state.sheets.forEach((sheet, i) => {
      sheet.classList.toggle("flipped", i < state.flipped);
      sheet.style.zIndex = i < state.flipped ? String(i + 1) : String(n - i);
      const depth = i < state.flipped ? (state.flipped - i) : (i - state.flipped);
      const dz = -depth * 0.55;
      sheet.children[0].style.transform = `translateZ(${dz}px)`;
      sheet.children[1].style.transform = `rotateY(180deg) translateZ(${dz}px)`;
    });
  }

  function flipTo(target) {
    const n = state.sheets.length;
    const clamped = Math.max(0, Math.min(n, target));
    if (clamped === state.flipped) return;
    state.flipped = clamped;
    layoutSheets();
    updateIndicator();
  }

  const next = () => flipTo(state.flipped + 1);
  const prev = () => flipTo(state.flipped - 1);
  const gotoToday = () => flipTo(faceToFlip(state.todayIndex));
  // 直达今日的「总览 + 进行中」对开页
  const gotoLive = () => flipTo(faceToFlip(state.todayIndex + (data.ok ? 1 : 0)));

  function updateIndicator() {
    const n = state.sheets.length;
    $("pageIndicator").textContent = `${state.flipped} / ${n} 张`;
    $("prevBtn").disabled = state.flipped === 0;
    $("nextBtn").disabled = state.flipped === n;
    const currentFace = state.flipped * 2;
    let activeEra = -1;
    state.eraFaceIndex.forEach((item, idx) => {
      if (item.faceIndex <= currentFace) activeEra = idx;
    });
    document.querySelectorAll(".tl-node").forEach((node, idx) => {
      node.classList.toggle("active", idx === activeEra);
    });
  }

  /* ============ 时间轴 ============ */

  function buildTimeline() {
    const tl = $("timeline");
    tl.innerHTML = "";
    state.eraFaceIndex.forEach((item) => {
      const btn = document.createElement("button");
      btn.className = "tl-node" + (item.today ? " tl-today" : "");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.textContent = item.label;
      btn.title = item.title;
      btn.addEventListener("click", () => flipTo(faceToFlip(item.faceIndex)));
      tl.appendChild(btn);
    });
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
        if (!window.confirm("作废此事？将以「罢」印载入书中。")) { btn.disabled = false; return; }
        await del(`/records/${id}`);
        flash("已作废 · 罢");
      } else if (act === "del-rule") {
        if (!window.confirm("废除此例？屏中光阴将按余例重新归名。")) { btn.disabled = false; return; }
        await del(`/screen/rules/${id}`);
        flash("已废除 · 例消");
      } else if (act === "add-rule") {
        const errEl = $("rlError");
        const appMatch = ($("rlApp") ? $("rlApp").value : "").trim();
        const label = ($("rlLabel") ? $("rlLabel").value : "").trim();
        const startTime = ($("rlStart") ? $("rlStart").value : "").trim();
        const endTime = ($("rlEnd") ? $("rlEnd").value : "").trim();
        const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!appMatch || !label) {
          if (errEl) errEl.textContent = "何应用、何名，缺一不可。";
          btn.disabled = false;
          return;
        }
        if ((startTime === "") !== (endTime === "")) {
          if (errEl) errEl.textContent = "何时、何讫须成对，或都留空表全天。";
          btn.disabled = false;
          return;
        }
        if (startTime && (!timeRe.test(startTime) || !timeRe.test(endTime))) {
          if (errEl) errEl.textContent = "时刻格式须为 HH:MM，如 04:00。";
          btn.disabled = false;
          return;
        }
        if (startTime && startTime === endTime) {
          if (errEl) errEl.textContent = "何时与何讫相同；全天请两者留空。";
          btn.disabled = false;
          return;
        }
        await post("/screen/rules", {
          appMatch,
          label,
          ...(startTime ? { startTime, endTime, priority: 10 } : {}),
        });
        flash("已立例 · 立");
      } else if (act === "start") {
        const title = ($("nfTitle") ? $("nfTitle").value : "").trim();
        const errEl = $("nfError");
        if (!title) {
          if (errEl) errEl.textContent = "何事未书，不可开卷。";
          btn.disabled = false;
          return;
        }
        const project = ($("nfProject") ? $("nfProject").value : "").trim();
        const tags = ($("nfTags") ? $("nfTags").value : "")
          .split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        const created = await post("/records", {
          title,
          type: formType,
          project: project || undefined,
          tags: tags.length ? tags : undefined,
          source: "web",
        });
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
      } else if (t.matches && t.matches(".form-input")) {
        const startBtn = pages.querySelector(`[data-act="start"]`);
        if (startBtn) doAction(startBtn);
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
      try {
        await loadLive();
      } catch {
        return; // 后端暂时不可达，静默
      }
      if (liveSignature() !== state.signature) {
        // 有任务开始/结束（可能来自 CLI/MCP），整本重排；正在输入时跳过本轮
        if (isEditing()) return;
        try { await loadAll(); } catch { return; }
        buildBook(true);
      } else {
        patchLiveDom();
      }
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

  const INTERACTIVE = "input, textarea, select, button, .entry-text, .toc-scroll";

  function setupInput() {
    $("prevBtn").addEventListener("click", prev);
    $("nextBtn").addEventListener("click", next);

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
      $("prologue").classList.add("gone");
      $("stage").hidden = false;
      state.opened = true;
      // 开卷动画：翻开扉页露出目录；深链则直达对应页
      setTimeout(() => {
        const h = location.hash;
        if (h === "#today") return gotoLive();
        if (h === "#screen" || h === "#rules") {
          const idx = state.faces.findIndex((f) => f.type === h.slice(1));
          if (idx >= 0) return flipTo(faceToFlip(idx));
        }
        flipTo(1);
      }, 700);
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
