import { nanoid } from "nanoid";
import type { PluginJob } from "@echolog/plugin-sdk";
import type {
  FlowOutcomeResult,
  FlowReserveResult,
} from "./flow-store.js";
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

export function scheduledFlowDedupeKey(
  now: Date,
  intervalMinutes: number
): string {
  const intervalMs = intervalMinutes * 60_000;
  return `scheduled:${intervalMinutes}:${Math.floor(now.getTime() / intervalMs)}`;
}

function manualFlowDedupeKey(idempotencyKey?: string): string {
  return `manual:${idempotencyKey ?? nanoid(20)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export interface FlowPersistence {
  getSettings(): Promise<FlowSettings>;
  updateSettings(input: FlowSettingsUpdate): Promise<FlowSettings | null>;
  reserveNext(
    source: "manual" | "scheduled",
    dedupeKey: string,
    now?: Date,
    signal?: AbortSignal
  ): Promise<FlowReserveResult>;
  finalizeNotification(
    deliveryId: string,
    expectedVersion: number,
    result:
      | { delivered: true; channel: string | null; at: Date }
      | { delivered: false; error: string; at: Date }
  ): Promise<FlowDelivery>;
  listDeliveries(limit?: number, before?: Date): Promise<FlowDelivery[]>;
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
    const settings = await this.store.getSettings();
    return this.deliver(
      "scheduled",
      scheduledFlowDedupeKey(now, settings.intervalMinutes),
      now,
      signal
    );
  }

  private async deliver(
    source: "manual" | "scheduled",
    dedupeKey: string,
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

    // The store atomically decides whether this caller owns the notification
    // attempt. Existing/freshly in-flight duplicates remain observable without
    // causing another send; stale reservations are claimed across restarts.
    if (!reserved.shouldNotify) return reserved;

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
      // Preserve a reserved row on cancellation. The Host's rejecting timeout
      // releases its non-reentry guard, and the next identical bucket can
      // safely resume with the notification dedupe key after restart/timeout.
      if (signal?.aborted || isAbortError(error)) throw error;
      candidate.delivery = await this.store.finalizeNotification(
        candidate.delivery.id,
        candidate.delivery.version,
        {
          delivered: false,
          // Do not persist exception text: provider errors may echo request
          // bodies. The ledger records a stable diagnostic without retaining
          // notification content, prompts, or replies.
          error: "notifications.send failed",
          at: this.clock(),
        }
      );
      return reserved;
    }

    candidate.delivery = await this.store.finalizeNotification(
      candidate.delivery.id,
      candidate.delivery.version,
      notification.delivered
        ? {
            delivered: true,
            channel: notification.channel ?? null,
            at: this.clock(),
          }
        : {
            delivered: false,
            error: "notifications.send reported an undelivered notification",
            at: this.clock(),
          }
    );
    return reserved;
  }

  listDeliveries(limit?: number, before?: Date) {
    return this.store.listDeliveries(limit, before);
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
