import type { PluginDefinition } from "@echolog/plugin-sdk";
import { schedulePlugin } from "@echolog/plugin-schedule";
import { screenTimePlugin } from "@echolog/plugin-screen-time";
import { tmuxStatusPlugin } from "@echolog/plugin-tmux-status";

export const bundledPlugins: readonly PluginDefinition[] = [
  schedulePlugin,
  screenTimePlugin,
  tmuxStatusPlugin,
];

export const bundledPluginWebAssets = [{
  prefix: "/plugins/schedule/",
  root: "schedule/web",
}, {
  prefix: "/plugins/screen-time/",
  root: "screen-time/web",
}] as const;
