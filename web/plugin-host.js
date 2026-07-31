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

    async stop() {
      for (const contribution of modules.values()) {
        await contribution?.unmount?.();
      }
      modules.clear();
    },
  };
}
