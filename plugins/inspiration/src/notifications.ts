import type {
  PluginContext,
  PluginNotificationChannelResult,
  PluginNotificationResult,
  PluginNotificationSend,
} from "@echolog/plugin-sdk";
import type { FlowCandidate } from "./types.js";

const MAX_NOTIFICATION_CHANNEL_ERROR_LENGTH = 160;

export type NotificationsSendProvider = () => PluginNotificationSend;

function projectChannelResult(
  channel: "mac" | "ntfy",
  value: unknown
): PluginNotificationChannelResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`notifications.send returned an invalid ${channel} result`);
  }
  const result = value as Record<string, unknown>;
  if (result.status === "sent") return { status: "sent" };
  if (result.status === "disabled") return { status: "disabled" };
  if (result.status === "failed" && typeof result.error === "string") {
    return {
      status: "failed",
      error: result.error.slice(0, MAX_NOTIFICATION_CHANNEL_ERROR_LENGTH),
    };
  }
  throw new Error(`notifications.send returned an invalid ${channel} result`);
}

export function projectNotificationResult(
  result: PluginNotificationResult
): PluginNotificationResult {
  const channels = (result as unknown as { channels?: unknown }).channels;
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) {
    throw new Error("notifications.send returned invalid channels");
  }
  const source = channels as Record<string, unknown>;
  return {
    channels: {
      mac: projectChannelResult("mac", source.mac),
      ntfy: projectChannelResult("ntfy", source.ntfy),
    },
  };
}

export function notificationsSendProvider(
  context: PluginContext
): NotificationsSendProvider {
  // Service resolution must remain lazy: capture and organization continue to
  // work when the independently shipped notification capability is absent.
  return () => context.service("notifications.send");
}

export function sendFlowNotification(
  provider: NotificationsSendProvider,
  candidate: FlowCandidate,
  signal?: AbortSignal
): Promise<PluginNotificationResult> {
  signal?.throwIfAborted();
  // The ledger key is stable and unique per delivery. Prefix it to keep Core's
  // transport-level dedupe namespace independent from other bundled plugins.
  return provider()(
    {
      title: "Inspiration",
      message: candidate.inspiration.content,
      dedupeKey: `inspiration:${candidate.delivery.dedupeKey}`,
    },
    signal
  ).then(projectNotificationResult);
}
