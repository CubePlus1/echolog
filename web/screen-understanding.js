const API_ROOT = "/api/plugins/screen-time/understanding";
const $ = (id) => document.getElementById(id);
const state = { settings: null, providers: [], selectedProviderId: "", latest: null, history: [], plugin: null };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

function showMessage(id, message, error = false) {
  const element = $(id);
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("is-error", error);
}

let toastTimer = 0;
function toast(message, error = false) {
  const element = $("toast");
  element.textContent = message;
  element.classList.toggle("is-error", error);
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 3200);
}

function selectedProvider() {
  return state.providers.find((provider) => provider.id === state.selectedProviderId) || null;
}

function keyStateText(hasApiKey) {
  return hasApiKey === null ? "密钥状态不可用" : hasApiKey ? "密钥已保存" : "尚无密钥";
}

function renderProvider() {
  const select = $("providerSelect");
  const empty = $("providerEmpty");
  const details = $("providerDetails");
  select.innerHTML = state.providers.map((provider) =>
    `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.displayName)} · ${keyStateText(provider.hasApiKey)}</option>`
  ).join("");
  if (state.providers.length === 0) {
    select.hidden = true;
    empty.hidden = false;
    details.hidden = true;
    $("keyBadge").textContent = "未选择";
    $("keyBadge").className = "mini-status";
    $("deleteKey").hidden = true;
    return;
  }
  select.hidden = false;
  empty.hidden = true;
  if (!state.providers.some((provider) => provider.id === state.selectedProviderId)) {
    state.selectedProviderId = state.settings?.providerProfileId || state.providers[0].id;
  }
  select.value = state.selectedProviderId;
  const provider = selectedProvider();
  details.hidden = !provider;
  if (!provider) return;
  $("providerName").value = provider.displayName;
  $("providerModel").value = provider.model;
  $("providerBaseUrl").value = provider.baseUrl;
  $("providerVersion").textContent = `v${provider.version}`;
  const badge = $("keyBadge");
  badge.textContent = keyStateText(provider.hasApiKey);
  badge.className = `mini-status ${provider.hasApiKey === null ? "is-unknown" : provider.hasApiKey ? "is-saved" : "is-missing"}`;
  $("apiKeyInput").placeholder = provider.hasApiKey === true
    ? "输入新密钥以替换"
    : provider.hasApiKey === null ? "输入密钥以保存或替换" : "输入 API Key";
  $("saveKey").textContent = provider.hasApiKey === true ? "替换密钥" : "保存密钥";
  $("deleteKey").hidden = provider.hasApiKey === false;
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) return;
  $("settingsEnabled").checked = settings.enabled;
  $("settingsSkipIdle").checked = settings.skipWhenIdle;
  $("settingsInterval").value = settings.captureIntervalSeconds;
  $("settingsBudget").value = settings.dailyRequestBudget;
  $("settingsVersion").textContent = `v${settings.version}`;
  $("heroHint").textContent = settings.enabled
    ? `周期识别 · 每 ${settings.captureIntervalSeconds / 60} 分钟`
    : "识别当前未启用";
}

function renderLatest() {
  const empty = $("latestEmpty");
  const card = $("latestResult");
  if (!state.latest) {
    empty.hidden = false;
    card.hidden = true;
    $("latestTime").textContent = "—";
    return;
  }
  empty.hidden = true;
  card.hidden = false;
  $("latestTime").textContent = formatTime(state.latest.completedAt);
  $("latestSummary").textContent = state.latest.summary;
  $("latestActivity").textContent = state.latest.activity;
  $("latestConfidence").textContent = `置信度 ${Math.round(state.latest.confidence * 100)}%`;
  $("latestModel").textContent = `${state.latest.providerProfileId} · ${state.latest.model}`;
  $("latestSensitive").hidden = !state.latest.sensitive;
  $("latestApps").innerHTML = (state.latest.apps || []).map((app) => `<span class="app-chip">${escapeHtml(app)}</span>`).join("");
}

function renderHistory() {
  const list = $("historyList");
  const empty = $("historyEmpty");
  empty.hidden = state.history.length > 0;
  list.innerHTML = state.history.map((item) => `
    <div class="history-row">
      <time class="history-time">${escapeHtml(formatTime(item.completedAt))}</time>
      <div><div class="history-summary">${escapeHtml(item.summary)}</div><div class="history-sub">${escapeHtml(item.activity)} · ${escapeHtml(item.model)}</div></div>
      <button class="history-delete" type="button" data-delete-id="${escapeHtml(item.id)}" title="删除这条记录" aria-label="删除这条记录">×</button>
    </div>`).join("");
}

function renderService() {
  const badge = $("serviceBadge");
  const ready = state.plugin?.state === "ready";
  badge.textContent = ready ? "服务在线" : (state.plugin?.error?.message || "服务不可用");
  badge.className = `status-pill ${ready ? "is-ready" : "is-error"}`;
}

function render() {
  renderService();
  renderProvider();
  renderSettings();
  renderLatest();
  renderHistory();
  $("updatedAt").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

async function load() {
  const [plugins, settings, providerResult, latest, history] = await Promise.all([
    api("/api/plugins"),
    api(`${API_ROOT}/settings`),
    api(`${API_ROOT}/providers`),
    api(`${API_ROOT}/latest`),
    api(`${API_ROOT}/history?limit=30`),
  ]);
  state.plugin = (plugins.plugins || []).find((plugin) => plugin.id === "screen-time") || null;
  state.settings = settings;
  state.providers = providerResult.providers || [];
  state.latest = latest;
  state.history = history || [];
  render();
}

async function saveKey() {
  const provider = selectedProvider();
  const value = $("apiKeyInput").value;
  if (!provider) return showMessage("keyMessage", "请先选择模型配置。", true);
  if (!value) return showMessage("keyMessage", "请输入 API Key。", true);
  showMessage("keyMessage", "正在写入本机 Keychain…");
  try {
    await api(`${API_ROOT}/providers/${encodeURIComponent(provider.id)}/key`, { method: "PUT", body: JSON.stringify({ apiKey: value }) });
    $("apiKeyInput").value = "";
    showMessage("keyMessage", "密钥已保存到 macOS Keychain。", false);
    toast("API Key 保存成功");
    await load();
  } catch (error) {
    showMessage("keyMessage", error.message, true);
    toast(error.message, true);
  }
}

async function deleteKey() {
  const provider = selectedProvider();
  if (!provider || !window.confirm("删除此配置的密钥？")) return;
  showMessage("keyMessage", "正在从本机 Keychain 删除…");
  try {
    await api(`${API_ROOT}/providers/${encodeURIComponent(provider.id)}/key`, { method: "DELETE" });
    showMessage("keyMessage", "密钥已从 macOS Keychain 删除。", false);
    toast("API Key 已删除");
    await load();
  } catch (error) {
    showMessage("keyMessage", error.message, true);
    toast(error.message, true);
  }
}

async function saveProvider() {
  const provider = selectedProvider();
  if (!provider) return;
  try {
    await api(`${API_ROOT}/providers/${encodeURIComponent(provider.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: provider.version,
        displayName: $("providerName").value.trim(),
        providerKind: "openai-compatible",
        baseUrl: $("providerBaseUrl").value.trim(),
        model: $("providerModel").value.trim(),
      }),
    });
    toast("模型配置已保存");
    await load();
  } catch (error) { toast(error.message, true); }
}

async function createProvider() {
  try {
    await api(`${API_ROOT}/providers`, {
      method: "POST",
      body: JSON.stringify({
        id: $("newProviderId").value.trim(),
        displayName: $("newProviderName").value.trim(),
        providerKind: "openai-compatible",
        baseUrl: $("newProviderBaseUrl").value.trim(),
        model: $("newProviderModel").value.trim(),
      }),
    });
    toast("模型配置已创建");
    document.querySelector(".create-details")?.removeAttribute("open");
    await load();
  } catch (error) { toast(error.message, true); }
}

async function saveSettings() {
  if (!state.settings) return;
  const providerProfileId = $("providerSelect").value || null;
  try {
    await api(`${API_ROOT}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: state.settings.version,
        enabled: $("settingsEnabled").checked,
        captureIntervalSeconds: Number($("settingsInterval").value),
        captureDisplay: "active",
        skipWhenIdle: $("settingsSkipIdle").checked,
        providerProfileId,
        requestTimeoutMs: state.settings.requestTimeoutMs,
        maxConcurrency: state.settings.maxConcurrency,
        maxAttempts: state.settings.maxAttempts,
        dailyRequestBudget: Number($("settingsBudget").value),
        dailyCostBudgetMicros: state.settings.dailyCostBudgetMicros,
        remoteConsentOrigin: state.settings.remoteConsentOrigin,
      }),
    });
    showMessage("settingsMessage", "识别设置已保存。", false);
    toast("识别设置已保存");
    await load();
  } catch (error) {
    showMessage("settingsMessage", error.message, true);
    toast(error.message, true);
  }
}

async function runNow() {
  const button = $("runNowHero");
  button.disabled = true;
  button.textContent = "识别中…";
  try {
    await api(`${API_ROOT}/run`, { method: "POST", body: "{}" });
    toast("屏幕识别完成");
    await load();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.innerHTML = "立即识别 <span>↗</span>"; }
}

async function deleteHistory(id) {
  try {
    await api(`${API_ROOT}/history/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("识别记录已删除");
    await load();
  } catch (error) { toast(error.message, true); }
}

$("providerSelect").addEventListener("change", (event) => { state.selectedProviderId = event.target.value; renderProvider(); });
$("saveKey").addEventListener("click", saveKey);
$("deleteKey").addEventListener("click", deleteKey);
$("saveProvider").addEventListener("click", saveProvider);
$("createProvider").addEventListener("click", createProvider);
$("saveSettings").addEventListener("click", saveSettings);
$("runNowHero").addEventListener("click", runNow);
$("refreshHistory").addEventListener("click", () => load().catch((error) => toast(error.message, true)));
$("historyList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-id]");
  if (button) deleteHistory(button.dataset.deleteId);
});

load().catch((error) => {
  $("serviceBadge").textContent = error.message;
  $("serviceBadge").className = "status-pill is-error";
  toast(error.message, true);
});
