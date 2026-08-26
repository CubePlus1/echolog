import type { PluginLogger, PluginNotificationSend } from "@echolog/plugin-sdk";
import { getDbUrl, type Config } from "../config.js";
import { sendNotification } from "../notifier.js";
import { runPluginCommand } from "./command-runner.js";
import { PluginHost } from "./host.js";
import { runPluginMigrations } from "./migrations.js";
import { bundledPlugins } from "./registry.js";

export function createPluginHost(config: Config, logger: PluginLogger): PluginHost {
  if (config.tracker) {
    logger.warn(
      { replacement: "plugins.screen-time" },
      "config.tracker is deprecated; migrate it to plugins.screen-time.config"
    );
  }
  const sendPluginNotification: PluginNotificationSend = (request, signal) =>
    sendNotification(request, signal, { loadConfig: () => config });

  return new PluginHost({
    definitions: bundledPlugins,
    configuration: config.plugins,
    logger,
    migrationRunner: runPluginMigrations,
    commandRunner: runPluginCommand,
    services: {
      "database.url": getDbUrl(config),
      "notifications.send": sendPluginNotification,
    },
  });
}
