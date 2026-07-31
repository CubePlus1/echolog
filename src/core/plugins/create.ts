import type { PluginLogger } from "@echolog/plugin-sdk";
import type { Config } from "../config.js";
import { runPluginCommand } from "./command-runner.js";
import { PluginHost } from "./host.js";
import { runPluginMigrations } from "./migrations.js";
import { bundledPlugins } from "./registry.js";

export function createPluginHost(config: Config, logger: PluginLogger): PluginHost {
  return new PluginHost({
    definitions: bundledPlugins,
    configuration: config.plugins,
    logger,
    migrationRunner: runPluginMigrations,
    commandRunner: runPluginCommand,
  });
}
