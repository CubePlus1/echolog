import type { PluginHost } from "./host.js";

let currentHost: PluginHost | null = null;

export function setCurrentPluginHost(host: PluginHost | null): void {
  currentHost = host;
}

export function getCurrentPluginHost(): PluginHost | null {
  return currentHost;
}
