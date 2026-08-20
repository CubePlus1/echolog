export async function activate({ api }) {
  let latestSettings = null;
  let latestProviders = [];

  return {
    id: "screen-time",
    faces() {
      return [
        { type: "screen" },
        { type: "rules" },
        { type: "understanding-settings" },
        { type: "understanding-providers" },
      ];
    },
    async load() {
      const [screen, rules, understandingSettings, providerResult, understandingLatest] = await Promise.all([
        api("/plugins/screen-time/today"),
        api("/plugins/screen-time/rules"),
        api("/plugins/screen-time/understanding/settings"),
        api("/plugins/screen-time/understanding/providers"),
        api("/plugins/screen-time/understanding/latest"),
      ]);
      latestSettings = understandingSettings;
      latestProviders = Array.isArray(providerResult.providers)
        ? providerResult.providers
        : [];
      return {
        screen,
        rules,
        understandingSettings,
        understandingProviders: latestProviders,
        understandingLatest: understandingLatest?.summary ? understandingLatest : null,
      };
    },
    renderFace(face, { data, esc, escA, fmtDur }) {
      if (face.type === "screen") {
        const screen = data.screen;
        let body;
        if (!screen || screen.totalSeconds === 0) {
          body = '<p class="toc-empty">屏中尚无光阴，或采样器未启。</p>';
        } else {
          body = screen.byLabel.map(({ label, seconds }) => {
            const apps = screen.apps
              .filter((app) => app.byLabel[label])
              .sort((a, b) => b.byLabel[label] - a.byLabel[label]);
            const rows = apps.slice(0, 6).map((app) =>
              `<div class="toc-row scr-row">
                <span class="toc-name">${esc(app.appName)}</span>
                <span class="toc-dots"></span>
                <span class="toc-time">${esc(fmtDur(app.byLabel[label]))}</span>
              </div>`
            ).join("");
            const restSeconds = apps
              .slice(6)
              .reduce((total, app) => total + app.byLabel[label], 0);
            const rest = restSeconds > 0
              ? `<div class="toc-row scr-row">
                  <span class="toc-name scr-rest">其余 ${apps.length - 6} 应用</span>
                  <span class="toc-dots"></span>
                  <span class="toc-time">${esc(fmtDur(restSeconds))}</span>
                </div>`
              : "";
            return `<div class="toc-section">${esc(label)} · ${esc(fmtDur(seconds))}</div>${rows}${rest}`;
          }).join("");
        }
        return `<div class="leaf-inner toc-face screen-face">
          <div class="toc-title">屏中光阴</div>
          <div class="scr-total">今日在屏 ${esc(screen ? fmtDur(screen.totalSeconds) : "—")}</div>
          <div class="toc-scroll" id="screenScroll">${body}</div>
        </div>`;
      }

      if (face.type === "rules") {
        const formatMinute = (minute) =>
          `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        const rows = data.rules.map((rule) =>
          `<div class="toc-row rule-row">
            <span class="rule-when">${rule.startMinute != null ? `${formatMinute(rule.startMinute)}–${formatMinute(rule.endMinute)}` : "全天"}</span>
            <span class="toc-name">${esc(rule.appMatch)}</span>
            <span class="toc-dots"></span>
            <span class="rule-label">${esc(rule.label)}</span>
            <button class="rule-del" type="button" data-act="del-rule" data-id="${escA(rule.id)}" title="废除此例">✕</button>
          </div>`
        ).join("");
        return `<div class="leaf-inner toc-face rules-face">
          <div class="toc-title">立 例</div>
          <div class="form-hint">同一应用，何时何名——如 04:00–06:00 的微信为「工作」，其余为「生活」</div>
          <div class="toc-scroll">
            ${rows || '<p class="toc-empty">尚未立例，屏中光阴皆「未分」。</p>'}
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

      if (face.type === "understanding-settings") {
        const settings = data.understandingSettings;
        const providers = data.understandingProviders ?? [];
        if (!settings) return null;
        const optionRows = providers.map((profile) =>
          `<option value="${escA(profile.id)}" ${settings.providerProfileId === profile.id ? "selected" : ""}>${esc(profile.displayName)} · ${profile.hasApiKey === null ? "密钥状态不可用" : profile.hasApiKey ? "有密钥" : "无密钥"}</option>`
        ).join("");
        return `<div class="leaf-inner toc-face understanding-settings-face">
          <div class="toc-title">识图设置</div>
          <div class="form-hint">启用后按间隔截图并调用选定 vision 模型；原始截图只在单次请求期间存在，不留图片历史。</div>
          <div class="rule-form">
            <div class="rule-form-grid">
              <label><input id="suEnabled" type="checkbox" ${settings.enabled ? "checked" : ""} /> 启用识图</label>
              <label><input id="suSkipIdle" type="checkbox" ${settings.skipWhenIdle ? "checked" : ""} /> 空闲时跳过</label>
              <select class="form-input" id="suProvider"><option value="">选择模型配置</option>${optionRows}</select>
              <input class="form-input" id="suInterval" type="number" min="60" max="3600" value="${escA(settings.captureIntervalSeconds)}" placeholder="截图间隔（秒）" />
              <input class="form-input" id="suTimeout" type="number" min="1000" max="120000" value="${escA(settings.requestTimeoutMs)}" placeholder="请求超时（毫秒）" />
              <input class="form-input" id="suConcurrency" type="number" min="1" max="8" value="${escA(settings.maxConcurrency)}" placeholder="并发数" />
              <input class="form-input" id="suAttempts" type="number" min="1" max="10" value="${escA(settings.maxAttempts)}" placeholder="最大尝试" />
              <input class="form-input" id="suRequestBudget" type="number" min="1" max="1440" value="${escA(settings.dailyRequestBudget)}" placeholder="每日请求预算" />
              <input class="form-input" id="suCostBudget" type="number" min="0" max="2000000000" value="${escA(settings.dailyCostBudgetMicros)}" placeholder="每日成本预算（微单位）" />
              <input class="form-input" id="suConsentOrigin" type="text" value="${escA(settings.remoteConsentOrigin ?? "")}" placeholder="远端授权来源（可空）" />
            </div>
            <div class="form-error" id="suError"></div>
            <div class="rule-form-foot">
              <span class="form-hint" style="margin:0">当前版本 ${esc(settings.version)}</span>
              <a href="/screen-understanding.html" target="_blank" rel="noreferrer">打开独立管理页</a>
              <button type="button" data-act="test-understanding-capture">测试截图</button>
              <button type="button" data-act="run-understanding">立即识别</button>
              <button class="seal-btn" type="button" data-act="save-understanding-settings"><span class="s-face">存</span><span class="s-label">保存</span></button>
            </div>
            <div class="capture-test-preview" id="suCapturePreview" hidden>
              <img id="suCaptureImage" alt="识图测试截图预览" />
              <div class="form-hint" id="suCaptureMeta"></div>
            </div>
            ${data.understandingLatest ? `<div class="understanding-result">
              <div class="toc-section">最近识别 · ${esc(new Date(data.understandingLatest.completedAt).toLocaleString("zh-CN"))}</div>
              <p>${esc(data.understandingLatest.summary)}</p>
              <div class="form-hint">${esc(data.understandingLatest.activity)} · 置信度 ${esc(Math.round(data.understandingLatest.confidence * 100))}%${data.understandingLatest.sensitive ? " · 含敏感内容" : ""}</div>
              ${data.understandingLatest.apps?.length ? `<div class="form-hint">应用：${esc(data.understandingLatest.apps.join("、"))}</div>` : ""}
            </div>` : '<p class="toc-empty">尚无识别结果。</p>'}
          </div>
        </div>`;
      }

      if (face.type === "understanding-providers") {
        const providers = data.understandingProviders ?? [];
        const rows = providers.map((profile) =>
          `<div class="rule-form">
            <div class="toc-section">${esc(profile.displayName)} · ${profile.hasApiKey === null ? "密钥状态不可用" : profile.hasApiKey ? "密钥已存" : "尚无密钥"}</div>
            <div class="rule-form-grid">
              <input class="form-input" id="spName:${escA(profile.id)}" type="text" value="${escA(profile.displayName)}" placeholder="显示名称" />
              <input class="form-input" id="spUrl:${escA(profile.id)}" type="url" value="${escA(profile.baseUrl)}" placeholder="API Base URL" />
              <input class="form-input" id="spModel:${escA(profile.id)}" type="text" value="${escA(profile.model)}" placeholder="模型" />
              <input class="form-input" id="spKey:${escA(profile.id)}" type="password" autocomplete="new-password" placeholder="${profile.hasApiKey ? "输入新密钥以替换" : "输入 API Key"}" />
            </div>
            <div class="form-error" id="spError:${escA(profile.id)}"></div>
            <div class="rule-form-foot">
              <span class="form-hint" style="margin:0">${esc(profile.id)} · v${esc(profile.version)}</span>
              <button type="button" data-act="save-provider" data-id="${escA(profile.id)}">保存配置</button>
              <button type="button" data-act="set-provider-key" data-id="${escA(profile.id)}">${profile.hasApiKey ? "替换密钥" : "保存密钥"}</button>
              ${profile.hasApiKey ? `<button type="button" data-act="delete-provider-key" data-id="${escA(profile.id)}">删除密钥</button>` : ""}
              <button class="rule-del" type="button" data-act="delete-provider" data-id="${escA(profile.id)}">删除配置</button>
            </div>
          </div>`
        ).join("");
        return `<div class="leaf-inner toc-face understanding-providers-face">
          <div class="toc-title">识图模型</div>
          <div class="toc-scroll">${rows || '<p class="toc-empty">尚无模型配置。</p>'}</div>
          <div class="rule-form">
            <div class="rule-form-grid">
              <input class="form-input" id="spNewId" type="text" placeholder="配置 ID（如 vision-primary）" />
              <input class="form-input" id="spNewName" type="text" placeholder="显示名称" />
              <input class="form-input" id="spNewUrl" type="url" placeholder="https://provider.example/v1" />
              <input class="form-input" id="spNewModel" type="text" placeholder="识图模型名称" />
            </div>
            <div class="form-error" id="spNewError"></div>
            <div class="rule-form-foot">
              <span class="form-hint" style="margin:0">密钥在创建配置后单独保存到 macOS Keychain</span>
              <button class="seal-btn" type="button" data-act="create-provider"><span class="s-face">增</span><span class="s-label">新建</span></button>
            </div>
          </div>
        </div>`;
      }
      return null;
    },
    async handleAction(action, { id, $, confirm }) {
      if (action === "del-rule") {
        if (!confirm("废除此例？屏中光阴将按余例重新归名。")) {
          return { handled: true, refresh: false };
        }
        await api(`/plugins/screen-time/rules/${id}`, { method: "DELETE" });
        return { handled: true, message: "已废除 · 例消" };
      }
      const setError = (elementId, error) => {
        const element = $(elementId);
        if (element) element.textContent = error instanceof Error ? error.message : String(error);
      };
      const integer = (elementId) => Number($(elementId)?.value);

      if (action === "test-understanding-capture") {
        const preview = $("suCapturePreview");
        const image = $("suCaptureImage");
        const metadata = $("suCaptureMeta");
        try {
          const result = await api("/plugins/screen-time/understanding/capture/test", {
            method: "POST",
            body: JSON.stringify({}),
          });
          const base64 = result?.preview?.base64;
          const valid = result?.format === "png" &&
            result?.preview?.mediaType === "image/png" &&
            typeof base64 === "string" &&
            base64.length > 0 &&
            base64.length <= 12_000_000 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(base64) &&
            Number.isInteger(result.widthPixels) && result.widthPixels > 0 && result.widthPixels <= 2560 &&
            Number.isInteger(result.heightPixels) && result.heightPixels > 0 && result.heightPixels <= 2560 &&
            Number.isInteger(result.bytes) && result.bytes > 0 && result.bytes <= 8 * 1024 * 1024;
          if (!valid || !image || !preview || !metadata) {
            throw new Error("invalid capture preview");
          }
          image.src = `data:image/png;base64,${base64}`;
          preview.hidden = false;
          metadata.textContent = `${result.widthPixels}×${result.heightPixels} · ${result.bytes} bytes · display ${result.displayId}`;
          setError("suError", "");
          return { handled: true, refresh: false, message: "测试截图完成" };
        } catch {
          if (image) image.src = "";
          if (preview) preview.hidden = true;
          if (metadata) metadata.textContent = "";
          setError("suError", "测试截图失败，请检查 helper、屏幕录制权限与本机服务状态");
          return { handled: true, refresh: false };
        }
      }

      if (action === "run-understanding") {
        try {
          await api("/plugins/screen-time/understanding/run", {
            method: "POST",
            body: JSON.stringify({}),
          });
          return { handled: true, message: "屏幕识别完成" };
        } catch (error) {
          setError("suError", error);
          return { handled: true, refresh: false };
        }
      }

      if (action === "save-understanding-settings") {
        const errorId = "suError";
        try {
          const providerProfileId = ($("suProvider")?.value ?? "").trim() || null;
          const remoteConsentOrigin = ($("suConsentOrigin")?.value ?? "").trim() || null;
          await api("/plugins/screen-time/understanding/settings", {
            method: "PUT",
            body: JSON.stringify({
              expectedVersion: latestSettings.version,
              enabled: Boolean($("suEnabled")?.checked),
              captureIntervalSeconds: integer("suInterval"),
              captureDisplay: "active",
              skipWhenIdle: Boolean($("suSkipIdle")?.checked),
              providerProfileId,
              requestTimeoutMs: integer("suTimeout"),
              maxConcurrency: integer("suConcurrency"),
              maxAttempts: integer("suAttempts"),
              dailyRequestBudget: integer("suRequestBudget"),
              dailyCostBudgetMicros: integer("suCostBudget"),
              remoteConsentOrigin,
            }),
          });
          return { handled: true, message: "识图设置已保存" };
        } catch (error) {
          setError(errorId, error);
          return { handled: true, refresh: false };
        }
      }

      if (action === "create-provider") {
        try {
          await api("/plugins/screen-time/understanding/providers", {
            method: "POST",
            body: JSON.stringify({
              id: ($("spNewId")?.value ?? "").trim(),
              displayName: ($("spNewName")?.value ?? "").trim(),
              providerKind: "openai-compatible",
              baseUrl: ($("spNewUrl")?.value ?? "").trim(),
              model: ($("spNewModel")?.value ?? "").trim(),
            }),
          });
          return { handled: true, message: "模型配置已创建" };
        } catch (error) {
          setError("spNewError", error);
          return { handled: true, refresh: false };
        }
      }

      const profile = latestProviders.find((item) => item.id === id);
      if (["save-provider", "set-provider-key", "delete-provider-key", "delete-provider"].includes(action) && !profile) {
        return { handled: true, refresh: false };
      }
      if (action === "save-provider") {
        try {
          await api(`/plugins/screen-time/understanding/providers/${encodeURIComponent(id)}`, {
            method: "PUT",
            body: JSON.stringify({
              expectedVersion: profile.version,
              displayName: ($(`spName:${id}`)?.value ?? "").trim(),
              providerKind: "openai-compatible",
              baseUrl: ($(`spUrl:${id}`)?.value ?? "").trim(),
              model: ($(`spModel:${id}`)?.value ?? "").trim(),
            }),
          });
          return { handled: true, message: "模型配置已保存" };
        } catch (error) {
          setError(`spError:${id}`, error);
          return { handled: true, refresh: false };
        }
      }
      if (action === "set-provider-key") {
        const input = $(`spKey:${id}`);
        try {
          const apiKey = input?.value ?? "";
          await api(`/plugins/screen-time/understanding/providers/${encodeURIComponent(id)}/key`, {
            method: "PUT",
            body: JSON.stringify({ apiKey }),
          });
          return { handled: true, message: "密钥已保存到 Keychain" };
        } catch (error) {
          setError(`spError:${id}`, "密钥保存失败，请检查本机 Keychain helper 状态");
          return { handled: true, refresh: false };
        } finally {
          if (input) input.value = "";
        }
      }
      if (action === "delete-provider-key") {
        if (!confirm("删除此配置的密钥？")) return { handled: true, refresh: false };
        try {
          await api(`/plugins/screen-time/understanding/providers/${encodeURIComponent(id)}/key`, { method: "DELETE" });
          return { handled: true, message: "密钥已删除" };
        } catch (error) {
          setError(`spError:${id}`, error);
          return { handled: true, refresh: false };
        }
      }
      if (action === "delete-provider") {
        if (!confirm("删除此模型配置？")) return { handled: true, refresh: false };
        try {
          await api(`/plugins/screen-time/understanding/providers/${encodeURIComponent(id)}`, {
            method: "DELETE",
            body: JSON.stringify({ expectedVersion: profile.version }),
          });
          return { handled: true, message: "模型配置已删除" };
        } catch (error) {
          setError(`spError:${id}`, error);
          return { handled: true, refresh: false };
        }
      }

      if (action !== "add-rule") return { handled: false };

      const errorElement = $("rlError");
      const appMatch = ($("rlApp")?.value ?? "").trim();
      const label = ($("rlLabel")?.value ?? "").trim();
      const startTime = ($("rlStart")?.value ?? "").trim();
      const endTime = ($("rlEnd")?.value ?? "").trim();
      const timeExpression = /^([01]\d|2[0-3]):([0-5]\d)$/;
      let error = "";
      if (!appMatch || !label) {
        error = "何应用、何名，缺一不可。";
      } else if ((startTime === "") !== (endTime === "")) {
        error = "何时、何讫须成对，或都留空表全天。";
      } else if (
        startTime &&
        (!timeExpression.test(startTime) || !timeExpression.test(endTime))
      ) {
        error = "时刻格式须为 HH:MM，如 04:00。";
      } else if (startTime && startTime === endTime) {
        error = "何时与何讫相同；全天请两者留空。";
      }
      if (error) {
        if (errorElement) errorElement.textContent = error;
        return { handled: true, refresh: false };
      }
      await api("/plugins/screen-time/rules", {
        method: "POST",
        body: JSON.stringify({
          appMatch,
          label,
          ...(startTime ? { startTime, endTime, priority: 10 } : {}),
        }),
      });
      return { handled: true, message: "已立例 · 立" };
    },
  };
}
