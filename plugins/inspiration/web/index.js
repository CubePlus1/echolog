const API_PREFIX = "/plugins/inspiration";

const INSPIRATION_STYLES = `<style>
  .inspiration-shell {
    --ins-line: rgba(90, 74, 58, 0.2);
    --ins-line-strong: rgba(176, 58, 46, 0.34);
    --ins-wash: rgba(255, 255, 255, 0.28);
    --ins-wash-strong: rgba(255, 255, 255, 0.48);
    container-type: inline-size;
    gap: 0.72rem !important;
    color: var(--ink);
  }
  .inspiration-shell *, .inspiration-shell *::before, .inspiration-shell *::after { box-sizing: border-box; }
  .inspiration-shell p, .inspiration-shell h2 { text-wrap: pretty; }
  .inspiration-hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.7rem;
    border-bottom: 1px solid var(--ins-line);
  }
  .inspiration-hero-copy { min-width: 0; }
  .inspiration-kicker {
    display: block;
    margin-bottom: 0.22rem;
    color: var(--cinnabar);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .inspiration-hero .toc-title { margin: 0; }
  .inspiration-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.34rem;
  }
  .inspiration-summary span,
  .inspiration-status,
  .inspiration-chip {
    display: inline-flex;
    align-items: center;
    min-height: 1.55rem;
    padding: 0.2rem 0.58rem;
    border: 1px solid var(--ins-line);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    color: var(--ink-soft);
    font-size: 0.64rem;
    line-height: 1;
  }
  .inspiration-summary b { color: var(--cinnabar); font-size: 0.74rem; }
  .inspiration-composer,
  .inspiration-card,
  .inspiration-settings,
  .inspiration-history {
    border: 1px solid var(--ins-line);
    border-radius: 0.8rem;
    background: var(--ins-wash);
    box-shadow: 0 0.5rem 1.5rem rgba(43, 33, 24, 0.055);
  }
  .inspiration-composer { padding: 0.72rem; }
  .inspiration-composer .form-input:first-of-type {
    min-height: 5.25rem;
    border-color: transparent;
    background: var(--ins-wash-strong);
    font-family: var(--kai);
    font-size: 1rem;
    line-height: 1.7;
  }
  .inspiration-composer .form-input:first-of-type:focus { border-color: var(--cinnabar); }
  .inspiration-composer-foot,
  .inspiration-card-actions,
  .inspiration-outcomes {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .inspiration-filter-panel { margin: 0; border-bottom: 1px solid var(--ins-line); }
  .inspiration-filter-panel > summary,
  .inspiration-settings > summary {
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.72rem;
    list-style: none;
  }
  .inspiration-filter-panel > summary::-webkit-details-marker,
  .inspiration-settings > summary::-webkit-details-marker { display: none; }
  .inspiration-filter-panel > summary::after,
  .inspiration-settings > summary::after { content: "+"; color: var(--cinnabar); font-size: 1rem; }
  .inspiration-filter-panel[open] > summary::after,
  .inspiration-settings[open] > summary::after { content: "−"; }
  .inspiration-filter-body { padding: 0 0 0.72rem; }
  .inspiration-checks { display: flex; flex-wrap: wrap; gap: 0.5rem 0.8rem; margin-top: 0.5rem; }
  .inspiration-checks label { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; color: var(--ink-soft); }
  .inspiration-card-list { display: grid; gap: 0.62rem; }
  .inspiration-card { position: relative; overflow: hidden; padding: 0.8rem; }
  .inspiration-card::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 2px;
    background: var(--gold);
    opacity: 0.55;
  }
  .inspiration-card[data-status="kept"]::before { background: var(--pine); opacity: 0.9; }
  .inspiration-card[data-status="archived"]::before { background: var(--ink-faint); }
  .inspiration-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    margin-bottom: 0.5rem;
  }
  .inspiration-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.32rem; min-width: 0; }
  .inspiration-status { color: var(--cinnabar); border-color: var(--ins-line-strong); font-weight: 700; }
  .inspiration-card[data-status="kept"] .inspiration-status { color: var(--pine); border-color: rgba(61, 92, 69, 0.34); }
  .inspiration-card[data-status="archived"] .inspiration-status { color: var(--ink-faint); border-color: var(--ins-line); }
  .inspiration-version { color: var(--ink-faint); font-size: 0.6rem; letter-spacing: 0.08em; white-space: nowrap; }
  .inspiration-card textarea { resize: vertical; font-family: var(--kai); line-height: 1.65; }
  .inspiration-card-copy { margin: 0.25rem 0 0.6rem; color: var(--ink); font-family: var(--kai); line-height: 1.7; }
  .inspiration-tags { display: flex; flex-wrap: wrap; gap: 0.28rem; min-height: 1.5rem; }
  .inspiration-chip { color: var(--pine); background: rgba(61, 92, 69, 0.07); }
  .inspiration-card-actions { margin-top: 0.58rem; padding-top: 0.56rem; border-top: 1px solid var(--ins-line); }
  .inspiration-card-actions button,
  .inspiration-outcomes button,
  .inspiration-history-foot button,
  .inspiration-filter-body button {
    min-height: 2.35rem;
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--ins-line);
    border-radius: 0.55rem;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.24);
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
    transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease;
  }
  .inspiration-card-actions button:hover,
  .inspiration-outcomes button:hover,
  .inspiration-history-foot button:hover,
  .inspiration-filter-body button:hover { transform: translateY(-1px); border-color: var(--cinnabar); }
  .inspiration-card-actions button:focus-visible,
  .inspiration-outcomes button:focus-visible,
  .inspiration-history-foot button:focus-visible,
  .inspiration-filter-body button:focus-visible { outline: 2px solid var(--cinnabar); outline-offset: 2px; }
  .inspiration-card-actions .inspiration-primary,
  .inspiration-outcomes .inspiration-primary { color: var(--paper); border-color: var(--cinnabar); background: var(--cinnabar); }
  .inspiration-card-actions .inspiration-danger { color: var(--cinnabar); }
  .inspiration-empty { padding: 1.4rem; text-align: center; border: 1px dashed var(--ins-line); border-radius: 0.8rem; }
  .inspiration-flow-layout { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(9rem, 0.8fr); gap: 0.7rem; min-height: 0; }
  .inspiration-flow-stage { min-width: 0; }
  .inspiration-flow-toolbar { display: flex; justify-content: flex-end; margin-bottom: 0.55rem; }
  .inspiration-flow-candidate { min-height: 14rem; display: flex; flex-direction: column; justify-content: space-between; }
  .inspiration-flow-candidate .inspiration-card-copy { font-size: 1.08rem; }
  .inspiration-explanation { margin: 0.5rem 0; color: var(--ink-faint); font-size: 0.68rem; line-height: 1.55; }
  .inspiration-outcomes { justify-content: flex-start; padding-top: 0.62rem; border-top: 1px solid var(--ins-line); }
  .inspiration-outcome-note { margin-top: 0.65rem; padding: 0.65rem; border: 1px dashed var(--ins-line); border-radius: 0.6rem; color: var(--ink-faint); font-size: 0.68rem; line-height: 1.55; }
  .inspiration-history { min-width: 0; padding: 0.7rem; }
  .inspiration-history-title { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.48rem; }
  .inspiration-history-title strong { font-family: var(--kai); font-size: 0.86rem; }
  .inspiration-history-title span { color: var(--ink-faint); font-size: 0.6rem; }
  .inspiration-history-list { display: grid; gap: 0.18rem; max-height: 21rem; overflow-y: auto; }
  .inspiration-history-row {
    display: grid;
    grid-template-columns: 0.42rem minmax(0, 1fr);
    gap: 0.48rem;
    padding: 0.5rem 0.28rem;
    border-bottom: 1px solid var(--ins-line);
  }
  .inspiration-history-row::before { content: ""; width: 0.38rem; height: 0.38rem; margin-top: 0.18rem; border-radius: 50%; background: var(--gold); }
  .inspiration-history-row[data-status="failed"]::before { background: var(--cinnabar); }
  .inspiration-history-row[data-status="sent"]::before { background: var(--pine); }
  .inspiration-history-row strong { display: block; overflow: hidden; color: var(--ink-soft); font-size: 0.66rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .inspiration-history-row time { color: var(--ink-faint); font-size: 0.58rem; }
  .inspiration-history-foot { margin-top: 0.55rem; }
  .inspiration-settings { margin-top: 0.7rem; padding: 0 0.72rem 0.72rem; }
  .inspiration-settings .rule-form { margin: 0; border: 0; background: transparent; box-shadow: none; }
  @container (max-width: 34rem) {
    .inspiration-hero { align-items: flex-start; flex-direction: column; }
    .inspiration-summary { justify-content: flex-start; }
    .inspiration-flow-layout { grid-template-columns: 1fr; }
    .inspiration-history-list { max-height: 12rem; }
    .inspiration-composer-foot { align-items: stretch; flex-direction: column; }
    .inspiration-card-actions button, .inspiration-outcomes button { flex: 1 1 7rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .inspiration-shell * { transition-duration: 0.01ms !important; }
  }
</style>`;

function renderShell(kind, content) {
  return `${INSPIRATION_STYLES}<div class="leaf-inner toc-face inspiration-shell inspiration-${kind}-face">${content}</div>`;
}

function inspirationStatusLabel(status) {
  return ({ inbox: "收件箱", kept: "保留", archived: "已归档" })[status] ?? String(status ?? "未知");
}

function deliveryStateLabel(delivery) {
  if (delivery?.status === "failed") {
    return delivery.source === "manual" ? "手动投递失败（未展示）" : "定时投递失败（未展示）";
  }
  const status = ({ reserved: "待投递", dispatching: "投递中", sent: "已展示" })[delivery?.status]
    ?? String(delivery?.status ?? "未知");
  const outcome = ({
    viewed: "已查看",
    continued: "继续编辑",
    kept: "已保留",
    later: "稍后再看",
    archived: "已归档",
  })[delivery?.outcome];
  return outcome ? `${status} · ${outcome}` : status;
}

function csv(value) {
  return String(value ?? "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMinute(minute) {
  const value = Number(minute) || 0;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function minuteOfDay(value) {
  const [hour, minute] = String(value ?? "").split(":").map(Number);
  return hour * 60 + minute;
}

function listPath(filters) {
  const params = new URLSearchParams({ limit: "50" });
  if (filters.text) params.set("text", filters.text);
  for (const tag of filters.tags) params.append("tag", tag);
  if (filters.project) params.set("project", filters.project);
  for (const status of filters.statuses) params.append("status", status);
  if (filters.includeArchived) params.set("includeArchived", "true");
  return `${API_PREFIX}/inspirations?${params}`;
}

function isActionableDelivery(delivery) {
  return Boolean(
    delivery &&
    delivery.source === "manual" &&
    delivery.status === "sent" &&
    delivery.outcome == null
  );
}

function inspirationSnapshotSignature(items) {
  return JSON.stringify(Array.isArray(items) ? items : []);
}

function deliverySnapshotSignature(deliveries, nextCursor) {
  return JSON.stringify([
    Array.isArray(deliveries) ? deliveries : [],
    typeof nextCursor === "string" ? nextCursor : null,
  ]);
}

function isHostEditing(root) {
  const active = root?.ownerDocument?.activeElement;
  return Boolean(
    active &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) &&
    active.closest?.("#pages")
  );
}

export async function activate({ api, refresh, root }) {
  let filters = {
    text: "",
    tags: [],
    project: "",
    statuses: ["inbox", "kept"],
    includeArchived: false,
  };
  let latestInspirations = [];
  let latestSettings = null;
  let latestDeliveries = [];
  let latestDeliveryNextCursor = null;
  let currentCandidate = null;
  let mounted = true;
  let lifecycleVersion = 0;
  let liveRequestVersion = 0;
  let refreshInFlight = null;
  let presentedInboxSignature = inspirationSnapshotSignature([]);
  let presentedFlowSignature = deliverySnapshotSignature([], null);

  const signaturesFor = (inspirations, deliveries, nextCursor) => ({
    inbox: inspirationSnapshotSignature(inspirations),
    flow: deliverySnapshotSignature(deliveries, nextCursor),
  });

  const applyLiveSnapshot = (inspirations, deliveries, nextCursor) => {
    latestInspirations = inspirations;
    latestDeliveries = deliveries;
    latestDeliveryNextCursor = nextCursor;
    if (currentCandidate) {
      const currentDelivery = deliveries.find(
        (delivery) => delivery.id === currentCandidate.delivery.id
      );
      const currentInspiration = inspirations.find(
        (inspiration) => inspiration.id === currentCandidate.inspiration.id
      );
      currentCandidate = {
        ...currentCandidate,
        inspiration: currentInspiration ?? currentCandidate.inspiration,
        delivery: currentDelivery ?? currentCandidate.delivery,
      };
    }
  };

  async function loadSnapshot() {
    if (!mounted) return {};
    const expectedLifecycleVersion = lifecycleVersion;
    const [list, settings, ledger] = await Promise.all([
      api(listPath(filters)),
      api(`${API_PREFIX}/flow/settings`),
      api(`${API_PREFIX}/flow/deliveries?limit=20`),
    ]);
    if (!mounted || expectedLifecycleVersion !== lifecycleVersion) return {};
    latestInspirations = Array.isArray(list?.items) ? list.items : [];
    latestSettings = settings;
    latestDeliveries = Array.isArray(ledger?.deliveries) ? ledger.deliveries : [];
    latestDeliveryNextCursor = typeof ledger?.nextCursor === "string"
      ? ledger.nextCursor
      : null;
    const signatures = signaturesFor(
      latestInspirations,
      latestDeliveries,
      latestDeliveryNextCursor
    );
    presentedInboxSignature = signatures.inbox;
    presentedFlowSignature = signatures.flow;
    return {
      inspirationList: list,
      inspirationFlowSettings: settings,
      inspirationFlowDeliveries: ledger,
    };
  }

  const setError = ($, id, error) => {
    const element = $(id);
    if (element) element.textContent = error instanceof Error ? error.message : String(error ?? "");
  };

  return {
    id: "inspiration",
    faces() {
      return [{ type: "inspiration-inbox" }, { type: "inspiration-flow" }];
    },
    load: loadSnapshot,
    async loadLive() {
      if (!mounted) return {};
      if (refreshInFlight) {
        try {
          await refreshInFlight;
        } catch {
          // The initiating poll reports the Host refresh failure. A later poll
          // retries from a fresh server snapshot instead of joining a rebuild.
        }
        if (!mounted) return {};
      }
      const expectedLifecycleVersion = lifecycleVersion;
      const requestVersion = ++liveRequestVersion;
      const [list, ledger] = await Promise.all([
        api(listPath(filters)),
        api(`${API_PREFIX}/flow/deliveries?limit=20`),
      ]);
      if (
        !mounted ||
        expectedLifecycleVersion !== lifecycleVersion ||
        requestVersion !== liveRequestVersion
      ) return {};
      const nextInspirations = Array.isArray(list?.items) ? list.items : [];
      const nextDeliveries = Array.isArray(ledger?.deliveries) ? ledger.deliveries : [];
      const nextDeliveryNextCursor = typeof ledger?.nextCursor === "string"
        ? ledger.nextCursor
        : null;
      const liveData = {
        inspirationList: list,
        inspirationFlowDeliveries: ledger,
      };
      const signatures = signaturesFor(
        nextInspirations,
        nextDeliveries,
        nextDeliveryNextCursor
      );
      const snapshotChanged = signatures.inbox !== presentedInboxSignature
        || signatures.flow !== presentedFlowSignature;
      const canInvalidateHost = typeof refresh === "function";
      if (snapshotChanged && canInvalidateHost && isHostEditing(root)) {
        return liveData;
      }
      applyLiveSnapshot(nextInspirations, nextDeliveries, nextDeliveryNextCursor);
      if (
        snapshotChanged &&
        canInvalidateHost
      ) {
        const previousInboxSignature = presentedInboxSignature;
        const previousFlowSignature = presentedFlowSignature;
        const refreshPromise = Promise.resolve().then(() => refresh({}));
        refreshInFlight = refreshPromise;
        try {
          await refreshPromise;
          if (mounted && expectedLifecycleVersion === lifecycleVersion) {
            // The real Host refresh calls loadSnapshot(), which advances these
            // signatures to the data it rendered. Lightweight hosts/tests may
            // only honor the invalidation callback, so record its target when
            // no full load occurred.
            if (
              presentedInboxSignature === previousInboxSignature &&
              presentedFlowSignature === previousFlowSignature
            ) {
              presentedInboxSignature = signatures.inbox;
              presentedFlowSignature = signatures.flow;
            }
          }
        } finally {
          if (refreshInFlight === refreshPromise) refreshInFlight = null;
        }
      }
      return mounted && expectedLifecycleVersion === lifecycleVersion ? liveData : {};
    },
    renderFace(face, { esc, escA }) {
      if (face.type === "inspiration-inbox") {
        const rows = latestInspirations.map((item) => {
          const tags = Array.isArray(item.tags)
            ? item.tags.map((tag) => `<span class="inspiration-chip">#${esc(tag)}</span>`).join("")
            : "";
          const project = item.project ?? "未分项目";
          const cardHead = `<header class="inspiration-card-head">
            <div class="inspiration-card-meta">
              <span class="inspiration-status">${esc(inspirationStatusLabel(item.status))}</span>
              <span class="inspiration-chip">${esc(project)}</span>
            </div>
            <span class="inspiration-version">v${esc(item.version)}</span>
          </header>`;
          if (item.status === "archived") {
            return `<article class="inspiration-card" data-status="archived">
              ${cardHead}
              <p class="inspiration-card-copy">${esc(item.content)}</p>
              <div class="inspiration-tags">${tags}</div>
              <div class="inspiration-card-actions">
                <button class="inspiration-primary" type="button" data-act="restore-inspiration" data-id="${escA(item.id)}">恢复到收件箱</button>
              </div>
            </article>`;
          }
          return `<article class="inspiration-card" data-status="${escA(item.status)}">
            ${cardHead}
            <textarea class="form-input" id="inspirationContent:${escA(item.id)}" rows="3" aria-label="编辑灵感正文">${escA(item.content)}</textarea>
            <div class="rule-form-grid">
              <input class="form-input" id="inspirationTags:${escA(item.id)}" type="text" value="${escA((item.tags ?? []).join(","))}" placeholder="标签，逗号分隔" aria-label="灵感标签" />
              <input class="form-input" id="inspirationProject:${escA(item.id)}" type="text" value="${escA(item.project ?? "")}" placeholder="项目（可空）" aria-label="灵感项目" />
              <select class="form-input" id="inspirationStatus:${escA(item.id)}" aria-label="灵感状态">
                <option value="inbox" ${item.status === "inbox" ? "selected" : ""}>收件箱</option>
                <option value="kept" ${item.status === "kept" ? "selected" : ""}>保留</option>
              </select>
            </div>
            <div class="inspiration-tags">${tags}</div>
            <div class="form-error" id="inspirationError:${escA(item.id)}"></div>
            <div class="inspiration-card-actions">
              <button class="inspiration-primary" type="button" data-act="edit-inspiration" data-id="${escA(item.id)}">保存整理</button>
              <button class="inspiration-danger" type="button" data-act="archive-inspiration" data-id="${escA(item.id)}">归档</button>
            </div>
          </article>`;
        }).join("");
        const keptCount = latestInspirations.filter((item) => item.status === "kept").length;
        const archivedCount = latestInspirations.filter((item) => item.status === "archived").length;
        return renderShell("inbox", `
          <header class="inspiration-hero">
            <div class="inspiration-hero-copy">
              <span class="inspiration-kicker">INSPIRATION / INBOX</span>
              <div class="toc-title">灵感收件箱</div>
            </div>
            <div class="inspiration-summary" aria-label="当前灵感统计">
              <span><b>${esc(latestInspirations.length)}</b> 当前结果</span>
              <span><b>${esc(keptCount)}</b> 已保留</span>
              ${filters.includeArchived ? `<span><b>${esc(archivedCount)}</b> 已归档</span>` : ""}
            </div>
          </header>
          <section class="inspiration-composer" aria-label="快速捕捉灵感">
            <span class="inspiration-kicker">快速捕捉</span>
            <textarea class="form-input" id="inspirationNewContent" rows="3" placeholder="此刻想到什么？" aria-label="新灵感正文"></textarea>
            <div class="rule-form-grid">
              <input class="form-input" id="inspirationNewTags" type="text" placeholder="标签，逗号分隔" aria-label="新灵感标签" />
              <input class="form-input" id="inspirationNewProject" type="text" placeholder="项目（可空）" aria-label="新灵感项目" />
            </div>
            <div class="form-error" id="inspirationNewError"></div>
            <div class="inspiration-composer-foot">
              <span class="form-hint">可以稍后再整理标签和项目。</span>
              <button class="seal-btn" type="button" data-act="capture-inspiration"><span class="s-face">记</span><span class="s-label">捕捉</span></button>
            </div>
          </section>
          <details class="inspiration-filter-panel" ${filters.text || filters.tags.length || filters.project || filters.includeArchived ? "open" : ""}>
            <summary><span>搜索与筛选</span><span>${filters.statuses.map(inspirationStatusLabel).map(esc).join(" · ") || "全部状态"}</span></summary>
            <div class="inspiration-filter-body">
              <div class="rule-form-grid">
                <input class="form-input" id="inspirationFilterText" type="search" value="${escA(filters.text)}" placeholder="搜索正文" aria-label="搜索灵感正文" />
                <input class="form-input" id="inspirationFilterTags" type="text" value="${escA(filters.tags.join(","))}" placeholder="标签，逗号分隔" aria-label="按标签筛选" />
                <input class="form-input" id="inspirationFilterProject" type="text" value="${escA(filters.project)}" placeholder="项目" aria-label="按项目筛选" />
              </div>
              <div class="inspiration-checks">
                <label><input id="inspirationFilterInbox" type="checkbox" ${filters.statuses.includes("inbox") ? "checked" : ""} /> 收件箱</label>
                <label><input id="inspirationFilterKept" type="checkbox" ${filters.statuses.includes("kept") ? "checked" : ""} /> 保留</label>
                <label><input id="inspirationFilterArchived" type="checkbox" ${filters.statuses.includes("archived") ? "checked" : ""} /> 已归档</label>
                <label><input id="inspirationIncludeArchived" type="checkbox" ${filters.includeArchived ? "checked" : ""} /> 查询归档历史</label>
              </div>
              <div class="inspiration-card-actions">
                <button class="inspiration-primary" type="button" data-act="filter-inspirations">应用筛选</button>
                <button type="button" data-act="clear-inspiration-filters">清除筛选</button>
              </div>
            </div>
          </details>
          <div class="toc-scroll inspiration-card-list" aria-live="polite">${rows || '<p class="inspiration-empty">尚无匹配的灵感。</p>'}</div>
        `);
      }

      if (face.type === "inspiration-flow") {
        const candidate = currentCandidate;
        const candidateIsActionable = isActionableDelivery(candidate?.delivery);
        const outcomeControls = candidateIsActionable
          ? `<div class="rule-form-grid">
                <label class="form-hint" for="inspirationSnooze">选择「稍后」时延后多少分钟</label>
                <input class="form-input" id="inspirationSnooze" type="number" min="1" value="${escA(latestSettings?.defaultSnoozeMinutes ?? 120)}" placeholder="稍后分钟数" />
              </div>
              <div class="form-error" id="inspirationFlowError"></div>
              <div class="inspiration-outcomes" aria-label="记录这次灵感结果">
                <button type="button" data-act="inspiration-outcome-viewed" data-id="${escA(candidate.delivery.id)}">查看</button>
                <button class="inspiration-primary" type="button" data-act="inspiration-outcome-continued" data-id="${escA(candidate.delivery.id)}">继续编辑</button>
                <button type="button" data-act="inspiration-outcome-kept" data-id="${escA(candidate.delivery.id)}">保留</button>
                <button type="button" data-act="inspiration-outcome-later" data-id="${escA(candidate.delivery.id)}">稍后</button>
                <button type="button" data-act="inspiration-outcome-archived" data-id="${escA(candidate.delivery.id)}">归档</button>
              </div>`
          : candidate?.delivery.status === "failed"
            ? '<div class="inspiration-outcome-note" role="status">通知投递失败，未记录为已展示。这条失败投递不可操作；重新浮现会创建一条新投递。</div>'
            : '<div class="inspiration-outcome-note" role="status">此投递不可记录用户结果。</div>';
        const candidateBody = candidate
          ? `<article class="inspiration-card inspiration-flow-candidate" data-status="${escA(candidate.inspiration.status)}">
              <div>
                <header class="inspiration-card-head">
                  <div class="inspiration-card-meta">
                    <span class="inspiration-status">本次浮现</span>
                    <span class="inspiration-chip">${esc(candidate.inspiration.project ?? "未分项目")}</span>
                  </div>
                  <span class="inspiration-version">v${esc(candidate.inspiration.version)}</span>
                </header>
                <p class="inspiration-card-copy">${esc(candidate.inspiration.content)}</p>
                <div class="inspiration-tags">${(candidate.inspiration.tags ?? []).map((tag) => `<span class="inspiration-chip">#${esc(tag)}</span>`).join("")}</div>
                <p class="inspiration-explanation">${(candidate.explanation ?? []).map((reason) => esc(reason)).join(" · ")}</p>
              </div>
              ${outcomeControls}
            </article>`
          : '<p class="inspiration-empty">点「浮现下一条」，由服务端选择一条适合回看的灵感。</p>';
        const deliveryRows = latestDeliveries.map((delivery) => {
          return `<div class="inspiration-history-row" data-status="${escA(delivery.status)}">
            <div>
              <strong>${esc(deliveryStateLabel(delivery))}</strong>
              <time datetime="${escA(delivery.surfacedAt)}">${esc(new Date(delivery.surfacedAt).toLocaleString("zh-CN"))}</time>
            </div>
          </div>`;
        }).join("");
        const settings = latestSettings;
        const settingsBody = settings
          ? `<div class="rule-form-grid">
              <label><input id="inspirationFlowEnabled" type="checkbox" ${settings.enabled ? "checked" : ""} /> 启用定时 Flow</label>
              <input class="form-input" id="inspirationFlowInterval" type="number" min="1" value="${escA(settings.intervalMinutes)}" placeholder="间隔分钟" />
              <input class="form-input" id="inspirationFlowQuietStart" type="time" value="${escA(formatMinute(settings.quietStartMinute))}" />
              <input class="form-input" id="inspirationFlowQuietEnd" type="time" value="${escA(formatMinute(settings.quietEndMinute))}" />
              <input class="form-input" id="inspirationFlowCooldown" type="number" min="0" value="${escA(settings.cooldownMinutes)}" placeholder="冷却分钟" />
              <input class="form-input" id="inspirationFlowDailyLimit" type="number" min="1" value="${escA(settings.dailyLimit)}" placeholder="每日上限" />
              <input class="form-input" id="inspirationFlowDefaultSnooze" type="number" min="1" value="${escA(settings.defaultSnoozeMinutes)}" placeholder="默认稍后分钟" />
              <label><input id="inspirationFlowStatusInbox" type="checkbox" ${settings.statuses?.includes("inbox") ? "checked" : ""} /> 收件箱</label>
              <label><input id="inspirationFlowStatusKept" type="checkbox" ${settings.statuses?.includes("kept") ? "checked" : ""} /> 保留</label>
              <input class="form-input" id="inspirationFlowTags" type="text" value="${escA((settings.tags ?? []).join(","))}" placeholder="候选标签（空为不限）" />
              <input class="form-input" id="inspirationFlowProjects" type="text" value="${escA((settings.projects ?? []).join(","))}" placeholder="候选项目（空为不限）" />
            </div>`
          : '<p class="inspiration-empty">Flow 设置不可用。</p>';
        return renderShell("flow", `
          <header class="inspiration-hero">
            <div class="inspiration-hero-copy">
              <span class="inspiration-kicker">INSPIRATION / FLOW</span>
              <div class="toc-title">灵感 Flow</div>
            </div>
            <div class="inspiration-summary" aria-label="Flow 状态">
              <span><b>${esc(latestDeliveries.length)}</b> 近期投递</span>
              ${settings ? `<span><b>v${esc(settings.version)}</b> 选择规则</span>` : ""}
            </div>
          </header>
          <div class="inspiration-flow-layout">
            <section class="inspiration-flow-stage" aria-label="当前浮现灵感">
              <div class="inspiration-flow-toolbar">
                <button class="seal-btn" type="button" data-act="next-inspiration"><span class="s-face">浮</span><span class="s-label">浮现下一条</span></button>
              </div>
              ${candidateBody}
            </section>
            <aside class="inspiration-history" aria-label="Flow 投递历史">
              <div class="inspiration-history-title"><strong>投递历史</strong><span>新 → 旧</span></div>
              <div class="inspiration-history-list" role="log">${deliveryRows || '<p class="toc-empty">尚无 Flow 投递。</p>'}</div>
              ${latestDeliveryNextCursor ? '<div class="inspiration-history-foot"><button type="button" data-act="load-more-inspiration-deliveries">加载更多投递</button></div>' : ""}
            </aside>
          </div>
          <details class="inspiration-settings">
            <summary><span>Flow 设置</span><span>${settings ? `v${esc(settings.version)}` : "不可用"}</span></summary>
            <div class="rule-form">
              ${settingsBody}
              <div class="form-error" id="inspirationSettingsError"></div>
              ${settings ? '<div class="inspiration-card-actions"><button class="inspiration-primary" type="button" data-act="save-inspiration-settings">保存 Flow 设置</button></div>' : ""}
            </div>
          </details>
        `);
      }
      return null;
    },
    async handleAction(action, { id, $ }) {
      if (action === "capture-inspiration") {
        try {
          await api(`${API_PREFIX}/inspirations`, {
            method: "POST",
            body: JSON.stringify({
              content: $("inspirationNewContent")?.value ?? "",
              tags: csv($("inspirationNewTags")?.value),
              project: $("inspirationNewProject")?.value?.trim() || null,
              status: "inbox",
            }),
          });
          return { handled: true, message: "灵感已捕捉" };
        } catch (error) {
          setError($, "inspirationNewError", error);
          return { handled: true, refresh: false };
        }
      }
      if (action === "filter-inspirations") {
        filters = {
          text: $("inspirationFilterText")?.value?.trim() || "",
          tags: csv($("inspirationFilterTags")?.value),
          project: $("inspirationFilterProject")?.value?.trim() || "",
          statuses: [
            ...($("inspirationFilterInbox")?.checked ? ["inbox"] : []),
            ...($("inspirationFilterKept")?.checked ? ["kept"] : []),
            ...($("inspirationFilterArchived")?.checked ? ["archived"] : []),
          ],
          includeArchived: Boolean($("inspirationIncludeArchived")?.checked),
        };
        return { handled: true, message: "灵感筛选已应用" };
      }
      if (action === "clear-inspiration-filters") {
        filters = { text: "", tags: [], project: "", statuses: ["inbox", "kept"], includeArchived: false };
        return { handled: true, message: "灵感筛选已清除" };
      }

      const inspiration = latestInspirations.find((item) => item.id === id);
      if (action === "edit-inspiration" && inspiration) {
        try {
          await api(`${API_PREFIX}/inspirations/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: inspiration.version,
              content: $(`inspirationContent:${id}`)?.value ?? "",
              tags: csv($(`inspirationTags:${id}`)?.value),
              project: $(`inspirationProject:${id}`)?.value?.trim() || null,
              status: $(`inspirationStatus:${id}`)?.value,
            }),
          });
          return { handled: true, message: "灵感已整理" };
        } catch (error) {
          setError($, `inspirationError:${id}`, error);
          return { handled: true, refresh: false };
        }
      }
      if ((action === "archive-inspiration" || action === "restore-inspiration") && inspiration) {
        const operation = action === "archive-inspiration" ? "archive" : "restore";
        await api(`${API_PREFIX}/inspirations/${encodeURIComponent(id)}/${operation}`, {
          method: "POST",
          body: JSON.stringify({ expectedVersion: inspiration.version }),
        });
        return { handled: true, message: operation === "archive" ? "灵感已归档" : "灵感已恢复" };
      }
      if (action === "next-inspiration") {
        const result = await api(`${API_PREFIX}/flow/next`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        currentCandidate = result?.candidate ?? null;
        return {
          handled: true,
          message: currentCandidate ? "浮现了一条灵感" : "暂无符合条件的灵感",
        };
      }
      if (action === "load-more-inspiration-deliveries" && latestDeliveryNextCursor) {
        const page = await api(
          `${API_PREFIX}/flow/deliveries?limit=20&cursor=${encodeURIComponent(latestDeliveryNextCursor)}`
        );
        const existing = new Set(latestDeliveries.map((delivery) => delivery.id));
        for (const delivery of Array.isArray(page?.deliveries) ? page.deliveries : []) {
          if (!existing.has(delivery.id)) {
            existing.add(delivery.id);
            latestDeliveries.push(delivery);
          }
        }
        latestDeliveryNextCursor = typeof page?.nextCursor === "string"
          ? page.nextCursor
          : null;
        return { handled: true, message: "已加载更多 Flow 投递" };
      }
      const candidateIsActionable = isActionableDelivery(currentCandidate?.delivery);
      if (
        action.startsWith("inspiration-outcome-") &&
        currentCandidate?.delivery.id === id &&
        !candidateIsActionable
      ) {
        setError($, "inspirationFlowError", new Error(
          "只有成功展示且尚未处理的手动投递可以记录用户结果"
        ));
        return { handled: true, refresh: false };
      }
      if (
        action.startsWith("inspiration-outcome-") &&
        candidateIsActionable &&
        currentCandidate?.delivery.id === id
      ) {
        const outcome = action.slice("inspiration-outcome-".length);
        const body = {
          expectedDeliveryVersion: currentCandidate.delivery.version,
          expectedInspirationVersion: currentCandidate.inspiration.version,
          outcome,
        };
        if (outcome === "later" && $("inspirationSnooze")?.value !== "") {
          body.snoozeMinutes = Number($("inspirationSnooze").value);
        }
        try {
          await api(`${API_PREFIX}/flow/deliveries/${encodeURIComponent(id)}/outcome`, {
            method: "POST",
            body: JSON.stringify(body),
          });
          currentCandidate = null;
          return { handled: true, message: "Flow 结果已记录" };
        } catch (error) {
          setError($, "inspirationFlowError", error);
          return { handled: true, refresh: false };
        }
      }
      if (action === "save-inspiration-settings" && latestSettings) {
        try {
          await api(`${API_PREFIX}/flow/settings`, {
            method: "PATCH",
            body: JSON.stringify({
              expectedVersion: latestSettings.version,
              enabled: Boolean($("inspirationFlowEnabled")?.checked),
              intervalMinutes: Number($("inspirationFlowInterval")?.value),
              quietStartMinute: minuteOfDay($("inspirationFlowQuietStart")?.value),
              quietEndMinute: minuteOfDay($("inspirationFlowQuietEnd")?.value),
              cooldownMinutes: Number($("inspirationFlowCooldown")?.value),
              dailyLimit: Number($("inspirationFlowDailyLimit")?.value),
              defaultSnoozeMinutes: Number($("inspirationFlowDefaultSnooze")?.value),
              statuses: [
                ...($("inspirationFlowStatusInbox")?.checked ? ["inbox"] : []),
                ...($("inspirationFlowStatusKept")?.checked ? ["kept"] : []),
              ],
              tags: csv($("inspirationFlowTags")?.value),
              projects: csv($("inspirationFlowProjects")?.value),
            }),
          });
          return { handled: true, message: "Flow 设置已保存" };
        } catch (error) {
          setError($, "inspirationSettingsError", error);
          return { handled: true, refresh: false };
        }
      }
      return { handled: false };
    },
    async unmount() {
      mounted = false;
      lifecycleVersion += 1;
      liveRequestVersion += 1;
      refreshInFlight = null;
      latestInspirations = [];
      latestSettings = null;
      latestDeliveries = [];
      latestDeliveryNextCursor = null;
      currentCandidate = null;
    },
  };
}
