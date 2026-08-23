import type { PluginDefinition } from "@echolog/plugin-sdk";
import { inspirationPlugin } from "@echolog/plugin-inspiration";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import { tmuxStatusPlugin } from "@echolog/plugin-tmux-status";

export const bundledPlugins: readonly PluginDefinition[] = [
  inspirationPlugin,
  screenTimePlugin,
  tmuxStatusPlugin,
];

export const bundledPluginWebAssets = [{
  prefix: "/plugins/screen-time/",
  root: "screen-time/web",
}, {
  prefix: "/plugins/inspiration/",
  root: "inspiration/web",
}] as const;
