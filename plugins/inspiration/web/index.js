const API_PREFIX = "/plugins/inspiration";

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

export async function activate({ api }) {
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
  let currentCandidate = null;

  async function loadSnapshot() {
    const [list, settings, ledger] = await Promise.all([
      api(listPath(filters)),
      api(`${API_PREFIX}/flow/settings`),
      api(`${API_PREFIX}/flow/deliveries?limit=20`),
    ]);
    latestInspirations = Array.isArray(list?.items) ? list.items : [];
    latestSettings = settings;
    latestDeliveries = Array.isArray(ledger?.deliveries) ? ledger.deliveries : [];
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
      const [list, ledger] = await Promise.all([
        api(listPath(filters)),
        api(`${API_PREFIX}/flow/deliveries?limit=20`),
      ]);
      latestInspirations = Array.isArray(list?.items) ? list.items : [];
      latestDeliveries = Array.isArray(ledger?.deliveries) ? ledger.deliveries : [];
      return {
        inspirationList: list,
        inspirationFlowDeliveries: ledger,
      };
    },
    renderFace(face, { esc, escA }) {
      if (face.type === "inspiration-inbox") {
        const rows = latestInspirations.map((item) => {
          const tags = Array.isArray(item.tags)
            ? item.tags.map((tag) => `<span class="type-chip">#${esc(tag)}</span>`).join(" ")
            : "";
          const metadata = [item.project, item.status, `v${item.version}`]
            .filter(Boolean)
            .map((value) => esc(value))
            .join(" · ");
          if (item.status === "archived") {
            return `<article class="rule-form inspiration-row">
              <div class="toc-section">${metadata}</div>
              <p>${esc(item.content)}</p>
              <div class="form-hint">${tags}</div>
              <div class="rule-form-foot">
                <button type="button" data-act="restore-inspiration" data-id="${escA(item.id)}">恢复到收件箱</button>
              </div>
            </article>`;
          }
          return `<article class="rule-form inspiration-row">
            <div class="toc-section">${metadata}</div>
            <textarea class="form-input" id="inspirationContent:${escA(item.id)}" rows="3">${escA(item.content)}</textarea>
            <div class="rule-form-grid">
              <input class="form-input" id="inspirationTags:${escA(item.id)}" type="text" value="${escA((item.tags ?? []).join(","))}" placeholder="标签，逗号分隔" />
              <input class="form-input" id="inspirationProject:${escA(item.id)}" type="text" value="${escA(item.project ?? "")}" placeholder="项目（可空）" />
              <select class="form-input" id="inspirationStatus:${escA(item.id)}">
                <option value="inbox" ${item.status === "inbox" ? "selected" : ""}>收件箱</option>
                <option value="kept" ${item.status === "kept" ? "selected" : ""}>保留</option>
              </select>
            </div>
            <div class="form-hint">${tags}</div>
            <div class="form-error" id="inspirationError:${escA(item.id)}"></div>
            <div class="rule-form-foot">
              <button type="button" data-act="edit-inspiration" data-id="${escA(item.id)}">保存整理</button>
              <button class="rule-del" type="button" data-act="archive-inspiration" data-id="${escA(item.id)}">归档</button>
            </div>
          </article>`;
        }).join("");
        return `<div class="leaf-inner toc-face inspiration-inbox-face">
          <div class="toc-title">灵感收件箱</div>
          <div class="rule-form">
            <textarea class="form-input" id="inspirationNewContent" rows="3" placeholder="此刻想到什么？"></textarea>
            <div class="rule-form-grid">
              <input class="form-input" id="inspirationNewTags" type="text" placeholder="标签，逗号分隔" />
              <input class="form-input" id="inspirationNewProject" type="text" placeholder="项目（可空）" />
            </div>
            <div class="form-error" id="inspirationNewError"></div>
            <div class="rule-form-foot">
              <button class="seal-btn" type="button" data-act="capture-inspiration"><span class="s-face">记</span><span class="s-label">捕捉</span></button>
            </div>
          </div>
          <div class="rule-form">
            <div class="rule-form-grid">
              <input class="form-input" id="inspirationFilterText" type="search" value="${escA(filters.text)}" placeholder="搜索正文" />
              <input class="form-input" id="inspirationFilterTags" type="text" value="${escA(filters.tags.join(","))}" placeholder="标签，逗号分隔" />
              <input class="form-input" id="inspirationFilterProject" type="text" value="${escA(filters.project)}" placeholder="项目" />
              <label><input id="inspirationFilterInbox" type="checkbox" ${filters.statuses.includes("inbox") ? "checked" : ""} /> 收件箱</label>
              <label><input id="inspirationFilterKept" type="checkbox" ${filters.statuses.includes("kept") ? "checked" : ""} /> 保留</label>
              <label><input id="inspirationFilterArchived" type="checkbox" ${filters.statuses.includes("archived") ? "checked" : ""} /> 已归档</label>
              <label><input id="inspirationIncludeArchived" type="checkbox" ${filters.includeArchived ? "checked" : ""} /> 查询归档历史</label>
            </div>
            <div class="rule-form-foot">
              <button type="button" data-act="filter-inspirations">筛选</button>
              <button type="button" data-act="clear-inspiration-filters">清除筛选</button>
            </div>
          </div>
          <div class="toc-scroll">${rows || '<p class="toc-empty">尚无匹配的灵感。</p>'}</div>
        </div>`;
      }

      if (face.type === "inspiration-flow") {
        const candidate = currentCandidate;
        const candidateBody = candidate
          ? `<article class="rule-form inspiration-flow-candidate">
              <div class="toc-section">本次浮现 · ${esc(candidate.inspiration.project ?? "未分项目")} · v${esc(candidate.inspiration.version)}</div>
              <p>${esc(candidate.inspiration.content)}</p>
              <div class="form-hint">${(candidate.inspiration.tags ?? []).map((tag) => `#${esc(tag)}`).join(" ")}</div>
              <div class="form-hint">${(candidate.explanation ?? []).map((reason) => esc(reason)).join(" · ")}</div>
              <div class="rule-form-grid">
                <input class="form-input" id="inspirationSnooze" type="number" min="1" value="${escA(latestSettings?.defaultSnoozeMinutes ?? 120)}" placeholder="稍后分钟数" />
              </div>
              <div class="form-error" id="inspirationFlowError"></div>
              <div class="rule-form-foot">
                <button type="button" data-act="inspiration-outcome-viewed" data-id="${escA(candidate.delivery.id)}">查看</button>
                <button type="button" data-act="inspiration-outcome-continued" data-id="${escA(candidate.delivery.id)}">继续编辑</button>
                <button type="button" data-act="inspiration-outcome-kept" data-id="${escA(candidate.delivery.id)}">保留</button>
                <button type="button" data-act="inspiration-outcome-later" data-id="${escA(candidate.delivery.id)}">稍后</button>
                <button type="button" data-act="inspiration-outcome-archived" data-id="${escA(candidate.delivery.id)}">归档</button>
              </div>
            </article>`
          : '<p class="toc-empty">点「浮现下一条」使用服务端选择器。</p>';
        const deliveryRows = latestDeliveries.map((delivery) =>
          `<div class="toc-row">
            <span class="toc-name">${esc(delivery.status)} · ${esc(delivery.outcome ?? "未处理")}</span>
            <span class="toc-dots"></span>
            <span class="toc-time">${esc(new Date(delivery.surfacedAt).toLocaleString("zh-CN"))}</span>
          </div>`
        ).join("");
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
          : '<p class="toc-empty">Flow 设置不可用。</p>';
        return `<div class="leaf-inner toc-face inspiration-flow-face">
          <div class="toc-title">灵感 Flow</div>
          <div class="rule-form-foot">
            <button class="seal-btn" type="button" data-act="next-inspiration"><span class="s-face">浮</span><span class="s-label">浮现下一条</span></button>
          </div>
          ${candidateBody}
          <div class="toc-section">Flow 设置${settings ? ` · v${esc(settings.version)}` : ""}</div>
          <div class="rule-form">
            ${settingsBody}
            <div class="form-error" id="inspirationSettingsError"></div>
            ${settings ? '<div class="rule-form-foot"><button type="button" data-act="save-inspiration-settings">保存 Flow 设置</button></div>' : ""}
          </div>
          <div class="toc-section">投递历史</div>
          <div class="toc-scroll">${deliveryRows || '<p class="toc-empty">尚无 Flow 投递。</p>'}</div>
        </div>`;
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
      if (action.startsWith("inspiration-outcome-") && currentCandidate?.delivery.id === id) {
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
      latestInspirations = [];
      latestSettings = null;
      latestDeliveries = [];
      currentCandidate = null;
    },
  };
}
