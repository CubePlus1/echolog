import type { PluginDefinition } from "@echolog/plugin-sdk";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import { tmuxStatusPlugin } from "@echolog/plugin-tmux-status";

export const bundledPlugins: readonly PluginDefinition[] = [
  screenTimePlugin,
  tmuxStatusPlugin,
];

export const bundledPluginWebAssets = [{
  prefix: "/plugins/screen-time/",
  root: "screen-time/web",
}] as const;
