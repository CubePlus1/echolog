import { nanoid } from "nanoid";
import {
  PluginError,
  type PluginJob,
  type PluginNotificationResult,
} from "@echolog/plugin-sdk";
import type {
  FlowDeliveryPage,
  FlowNotificationFinalization,
  FlowOutcomeResult,
  FlowReserveResult,
} from "./flow-store.js";
export { scheduledFlowDedupeKey } from "./flow-store.js";
import type { DeliveryCursor } from "./pagination.js";
import {
  sendFlowNotification,
  type NotificationsSendProvider,
} from "./notifications.js";
import type {
  DailyInspirationSummary,
  FlowDelivery,
  FlowOutcomeInput,
  FlowSettings,
  FlowSettingsUpdate,
} from "./types.js";

export const FLOW_JOB_POLL_MS = 60_000;
export const FLOW_JOB_TIMEOUT_MS = 30_000;

function manualFlowDedupeKey(idempotencyKey?: string): string {
  return `manual:${idempotencyKey ?? nanoid(20)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function notificationFailureMessage(error: unknown): string {
  return error instanceof PluginError &&
    error.code === "PLUGIN_DEPENDENCY_MISSING"
    ? "notifications.send unavailable (PLUGIN_DEPENDENCY_MISSING)"
    : "notifications.send failed";
}

export function notificationWasDelivered(
  result: PluginNotificationResult
): boolean {
  return Object.values(result.channels).some(
    (channel) => channel.status === "sent"
  );
}

function noDeliveryMessage(result: PluginNotificationResult): string {
  return Object.values(result.channels).every(
    (channel) => channel.status === "disabled"
  )
    ? "notifications.send has no enabled channels"
    : "notifications.send failed on all enabled channels";
}

function explainFailedDelivery(result: FlowReserveResult): void {
  const reason = "delivery:failed";
  if (!result.explanation.includes(reason)) result.explanation.push(reason);
  if (
    result.candidate &&
    result.candidate.explanation !== result.explanation &&
    !result.candidate.explanation.includes(reason)
  ) {
    result.candidate.explanation.push(reason);
  }
}

export interface FlowPersistence {
  getSettings(): Promise<FlowSettings>;
  updateSettings(input: FlowSettingsUpdate): Promise<FlowSettings | null>;
  reserveNext(
    source: "manual" | "scheduled",
    dedupeKey: string | undefined,
    now?: Date,
    signal?: AbortSignal
  ): Promise<FlowReserveResult>;
  claimNotification(
    deliveryId: string,
    expectedVersion: number,
    now?: Date,
    signal?: AbortSignal
  ): Promise<FlowDelivery>;
  finalizeNotification(
    deliveryId: string,
    expectedVersion: number,
    result: FlowNotificationFinalization
  ): Promise<FlowDelivery>;
  listDeliveries(
    limit?: number,
    cursor?: DeliveryCursor
  ): Promise<FlowDeliveryPage>;
  applyOutcome(
    deliveryId: string,
    expectedDeliveryVersion: number,
    expectedInspirationVersion: number,
    outcome: FlowOutcomeInput["outcome"],
    snoozedUntil: Date | null,
    now?: Date
  ): Promise<FlowOutcomeResult>;
  getDailySummary(date: string): Promise<DailyInspirationSummary>;
}

export class FlowService {
  constructor(
    private readonly store: FlowPersistence,
    private readonly notifications: NotificationsSendProvider,
    private readonly clock: () => Date = () => new Date()
  ) {}

  getSettings(): Promise<FlowSettings> {
    return this.store.getSettings();
  }

  updateSettings(input: FlowSettingsUpdate): Promise<FlowSettings | null> {
    return this.store.updateSettings(input);
  }

  async nextManual(
    idempotencyKey?: string,
    signal?: AbortSignal
  ): Promise<FlowReserveResult> {
    return this.deliver(
      "manual",
      manualFlowDedupeKey(idempotencyKey),
      this.clock(),
      signal
    );
  }

  async runScheduled(signal: AbortSignal): Promise<FlowReserveResult> {
    signal.throwIfAborted();
    const now = this.clock();
    return this.deliver("scheduled", undefined, now, signal);
  }

  private async deliver(
    source: "manual" | "scheduled",
    dedupeKey: string | undefined,
    now: Date,
    signal?: AbortSignal
  ): Promise<FlowReserveResult> {
    const reserved = await this.store.reserveNext(
      source,
      dedupeKey,
      now,
      signal
    );
    const candidate = reserved.candidate;
    if (!candidate) return reserved;

    // The store atomically decides whether this caller owns a new reservation.
    // Existing or stale pending rows remain observable without another send.
    if (!reserved.shouldNotify) {
      if (candidate.delivery.status === "failed") {
        explainFailedDelivery(reserved);
      }
      return reserved;
    }

    // Cross an explicit durable boundary before invoking Core. A row that is
    // left dispatching has an unknown external outcome and is never reclaimed
    // for another send. The request carries a stable dedupe hint, but providers
    // may ignore it, so the ledger still enforces same-row at-most-once.
    candidate.delivery = await this.store.claimNotification(
      candidate.delivery.id,
      candidate.delivery.version,
      this.clock(),
      signal
    );

    let notification;
    try {
      signal?.throwIfAborted();
      notification = await sendFlowNotification(
        this.notifications,
        candidate,
        signal
      );
      signal?.throwIfAborted();
    } catch (error) {
      // Preserve dispatching on cancellation. The call may already have
      // reached an external channel, so restart recovery must diagnose the row
      // as unknown rather than invoke notifications.send again.
      if (signal?.aborted || isAbortError(error)) throw error;
      candidate.delivery = await this.store.finalizeNotification(
        candidate.delivery.id,
        candidate.delivery.version,
        {
          delivered: false,
          channels: null,
          // Do not persist exception text: provider errors may echo request
          // bodies. The ledger records a stable diagnostic without retaining
          // notification content, prompts, or replies.
          error: notificationFailureMessage(error),
          at: this.clock(),
        }
      );
      explainFailedDelivery(reserved);
      return reserved;
    }

    candidate.delivery = await this.store.finalizeNotification(
      candidate.delivery.id,
      candidate.delivery.version,
      notificationWasDelivered(notification)
        ? {
            delivered: true,
            channels: notification.channels,
            at: this.clock(),
          }
        : {
            delivered: false,
            channels: notification.channels,
            error: noDeliveryMessage(notification),
            at: this.clock(),
          }
    );
    if (candidate.delivery.status === "failed") {
      explainFailedDelivery(reserved);
    }
    return reserved;
  }

  listDeliveries(limit?: number, cursor?: DeliveryCursor) {
    return this.store.listDeliveries(limit, cursor);
  }

  async applyOutcome(
    deliveryId: string,
    input: FlowOutcomeInput
  ): Promise<FlowOutcomeResult> {
    const now = this.clock();
    let snoozedUntil: Date | null = null;
    if (input.outcome === "later") {
      const settings = await this.store.getSettings();
      const minutes = input.snoozeMinutes ?? settings.defaultSnoozeMinutes;
      snoozedUntil = new Date(now.getTime() + minutes * 60_000);
    }
    return this.store.applyOutcome(
      deliveryId,
      input.expectedDeliveryVersion,
      input.expectedInspirationVersion,
      input.outcome,
      snoozedUntil,
      now
    );
  }

  getDailySummary(date: string): Promise<DailyInspirationSummary> {
    return this.store.getDailySummary(date);
  }
}

export function createFlowJob(service: FlowService): PluginJob {
  return {
    id: "inspiration-flow",
    intervalMs: FLOW_JOB_POLL_MS,
    timeoutMs: FLOW_JOB_TIMEOUT_MS,
    async run(signal) {
      await service.runScheduled(signal);
    },
  };
}
