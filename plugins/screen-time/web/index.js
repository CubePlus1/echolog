export async function activate({ api }) {
  return {
    id: "screen-time",
    faces() {
      return [{ type: "screen" }, { type: "rules" }];
    },
    async load() {
      const [screen, rules] = await Promise.all([
        api("/plugins/screen-time/today"),
        api("/plugins/screen-time/rules"),
      ]);
      return { screen, rules };
    },
    async loadLive() {
      return { screen: await api("/plugins/screen-time/today") };
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
