import type { PluginContext } from "@echolog/plugin-sdk";
import type { FlowCandidate } from "./types.js";

export interface NotificationsSendInput {
  title: string;
  body: string;
  dedupeKey: string;
  data: {
    pluginId: "inspiration";
    inspirationId: string;
    deliveryId: string;
  };
}

export interface NotificationsSendResult {
  delivered: boolean;
  channel?: string;
}

export interface NotificationsSendService {
  send(
    input: NotificationsSendInput,
    signal?: AbortSignal
  ): Promise<NotificationsSendResult>;
}

export type NotificationsSendProvider = () => NotificationsSendService;

export function notificationsSendProvider(
  context: PluginContext
): NotificationsSendProvider {
  // Service resolution must remain lazy: capture and organization continue to
  // work when the independently shipped notification capability is absent.
  return () =>
    context.service<NotificationsSendService>("notifications.send");
}

export function sendFlowNotification(
  provider: NotificationsSendProvider,
  candidate: FlowCandidate,
  signal?: AbortSignal
): Promise<NotificationsSendResult> {
  signal?.throwIfAborted();
  return provider().send({
    title: "Inspiration",
    body: candidate.inspiration.content,
    dedupeKey: candidate.delivery.dedupeKey,
    data: {
      pluginId: "inspiration",
      inspirationId: candidate.inspiration.id,
      deliveryId: candidate.delivery.id,
    },
  }, signal);
}
