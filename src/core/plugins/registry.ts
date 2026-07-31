import type { PluginDefinition } from "@echolog/plugin-sdk";
import { screenTimePlugin } from "@echolog/plugin-screen-time";

export const bundledPlugins: readonly PluginDefinition[] = [screenTimePlugin];

export const bundledPluginWebAssets = [{
  prefix: "/plugins/screen-time/",
  root: "screen-time/web",
}] as const;
