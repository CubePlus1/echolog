import notifier from "node-notifier";
import type {
  PluginNotificationChannelResult,
  PluginNotificationRequest,
  PluginNotificationResult,
} from "@echolog/plugin-sdk";
import { loadConfig, type Config } from "./config.js";

const DELIVERY_TIMEOUT_MS = 5_000;
const MAX_ERROR_LENGTH = 160;

export interface MacNotificationOptions {
  title: string;
  message: string;
  sound: string;
  timeout: number;
}

export type MacNotify = (
  options: MacNotificationOptions,
  callback: (error: Error | null) => void
) => void;

export type NotificationFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Pick<Response, "ok" | "status">>;

export interface NotificationDependencies {
  loadConfig?: () => Config;
  macNotify?: MacNotify;
  fetch?: NotificationFetch;
  timeoutMs?: number;
}

class DeliveryTimeoutError extends Error {}

class CallerAbortError extends Error {
  override name = "AbortError";
}

function callerAbortError(): CallerAbortError {
  return new CallerAbortError("Notification delivery aborted");
}

function failed(error: string): PluginNotificationChannelResult {
  return {
    status: "failed",
    error: error.slice(0, MAX_ERROR_LENGTH),
  };
}

function failureResult(
  channel: "mac" | "ntfy",
  error: unknown
): PluginNotificationChannelResult {
  if (error instanceof DeliveryTimeoutError) {
    return failed(`${channel} notification timed out`);
  }
  return failed(`${channel} notification failed`);
}

function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onAbort);
    };
    const finish = (result: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ("error" in result) reject(result.error);
      else resolve(result.value);
    };
    const onAbort = () => {
      controller.abort();
      finish({ error: callerAbortError() });
    };

    if (callerSignal?.aborted) {
      onAbort();
      return;
    }
    callerSignal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish({ error: new DeliveryTimeoutError() });
    }, timeoutMs);

    queueMicrotask(() => {
      if (settled) return;

      let delivery: Promise<T>;
      try {
        delivery = operation(controller.signal);
      } catch (error) {
        finish({ error });
        return;
      }
      delivery.then(
        (value) => finish({ value }),
        (error: unknown) => finish({ error })
      );
    });
  });
}

const defaultMacNotify: MacNotify = (options, callback) => {
  notifier.notify(options, (error) => callback(error));
};

async function sendMac(
  request: PluginNotificationRequest,
  signal: AbortSignal | undefined,
  dependencies: Required<
    Pick<NotificationDependencies, "macNotify" | "timeoutMs">
  >
): Promise<PluginNotificationChannelResult> {
  try {
    await runBounded(
      () =>
        new Promise<void>((resolve, reject) => {
          dependencies.macNotify(
            {
              title: `EchoLog: ${request.title}`,
              message: request.message,
              sound: "default",
              timeout: 10,
            },
            (error) => (error ? reject(error) : resolve())
          );
        }),
      signal,
      dependencies.timeoutMs
    );
    return { status: "sent" };
  } catch (error) {
    if (error instanceof CallerAbortError) throw error;
    return failureResult("mac", error);
  }
}

async function sendNtfy(
  request: PluginNotificationRequest,
  config: Config,
  signal: AbortSignal | undefined,
  dependencies: Required<
    Pick<NotificationDependencies, "fetch" | "timeoutMs">
  >
): Promise<PluginNotificationChannelResult> {
  try {
    const response = await runBounded(
      (deliverySignal) => {
        const { server, topic } = config.notifications.ntfy;
        return dependencies.fetch(`${server}/${topic}`, {
          method: "POST",
          headers: { Title: `EchoLog: ${request.title}` },
          body: request.message,
          signal: deliverySignal,
        });
      },
      signal,
      dependencies.timeoutMs
    );
    if (!response.ok) {
      return failed(`ntfy notification failed with HTTP ${response.status}`);
    }
    return { status: "sent" };
  } catch (error) {
    if (error instanceof CallerAbortError) throw error;
    return failureResult("ntfy", error);
  }
}

export async function sendNotification(
  request: PluginNotificationRequest,
  signal?: AbortSignal,
  dependencies: NotificationDependencies = {}
): Promise<PluginNotificationResult> {
  if (signal?.aborted) throw callerAbortError();

  let config: Config;
  try {
    config = (dependencies.loadConfig ?? loadConfig)();
  } catch {
    const unavailable = failed("notification configuration unavailable");
    return { channels: { mac: unavailable, ntfy: unavailable } };
  }

  if (!config.notifications.enabled) {
    return {
      channels: {
        mac: { status: "disabled" },
        ntfy: { status: "disabled" },
      },
    };
  }

  const timeoutMs = dependencies.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  const mac = config.notifications.mac
    ? sendMac(request, signal, {
        macNotify: dependencies.macNotify ?? defaultMacNotify,
        timeoutMs,
      })
    : Promise.resolve<PluginNotificationChannelResult>({ status: "disabled" });
  const ntfy = config.notifications.ntfy.enabled
    ? sendNtfy(request, config, signal, {
        fetch: dependencies.fetch ?? globalThis.fetch,
        timeoutMs,
      })
    : Promise.resolve<PluginNotificationChannelResult>({ status: "disabled" });
  const [macResult, ntfyResult] = await Promise.all([mac, ntfy]);

  return { channels: { mac: macResult, ntfy: ntfyResult } };
}

export function notify(title: string, message: string): void {
  void sendNotification({ title, message }).catch(() => {});
}
