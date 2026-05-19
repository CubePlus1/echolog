import notifier from "node-notifier";
import { loadConfig } from "./config.js";

export function notifyMac(title: string, message: string) {
  const config = loadConfig();
  if (!config.notifications.enabled || !config.notifications.mac) return;

  notifier.notify({
    title: `EchoLog: ${title}`,
    message,
    sound: "default",
    timeout: 10,
  });
}

export async function notifyNtfy(title: string, message: string) {
  const config = loadConfig();
  if (!config.notifications.enabled || !config.notifications.ntfy.enabled)
    return;

  const { server, topic } = config.notifications.ntfy;
  const url = `${server}/${topic}`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { Title: `EchoLog: ${title}` },
      body: message,
    });
  } catch {
    // ntfy unavailable, fail silently
  }
}

export function notify(title: string, message: string) {
  notifyMac(title, message);
  notifyNtfy(title, message).catch(() => {});
}
