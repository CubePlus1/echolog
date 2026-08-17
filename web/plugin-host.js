export function createPluginWebHost(api) {
  const modules = new Map();

  return {
    async refresh(hostApi = {}) {
      const result = await api("/plugins");
      const plugins = Array.isArray(result.plugins) ? result.plugins : [];
      const readyIds = new Set();

      for (const plugin of plugins) {
        if (!plugin.enabled || plugin.state !== "ready" || !plugin.webEntry) continue;
        readyIds.add(plugin.id);
        if (modules.has(plugin.id)) continue;
        try {
          const imported = await import(plugin.webEntry);
          const contribution = await imported.activate?.(hostApi);
          modules.set(plugin.id, contribution ?? imported);
        } catch (error) {
          console.error(`Plugin Web module failed: ${plugin.id}`, error);
        }
      }

      for (const [id, contribution] of modules) {
        if (readyIds.has(id)) continue;
        await contribution?.unmount?.();
        modules.delete(id);
      }
      return [...modules.entries()].map(([id, contribution]) => ({
        id,
        contribution,
      }));
    },

    faces() {
      return [...modules.values()].flatMap(
        (contribution) => contribution?.faces?.() ?? []
      );
    },

    async loadData(target, { live = false } = {}) {
      for (const [id, contribution] of modules) {
        const loader = live ? contribution?.loadLive : contribution?.load;
        if (!loader) continue;
        try {
          Object.assign(target, await loader());
        } catch (error) {
          console.error(`Plugin Web data load failed: ${id}`, error);
        }
      }
    },

    renderFace(face, context) {
      for (const contribution of modules.values()) {
        const rendered = contribution?.renderFace?.(face, context);
        if (rendered != null) return rendered;
      }
      return null;
    },

    async handleAction(action, context) {
      for (const contribution of modules.values()) {
        const result = await contribution?.handleAction?.(action, context);
        if (result?.handled) return result;
      }
      return { handled: false };
    },

    async stop() {
      for (const contribution of modules.values()) {
        await contribution?.unmount?.();
      }
      modules.clear();
    },
  };
}
