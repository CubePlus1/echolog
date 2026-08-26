import type { DueReminder } from "./store.js";
import type {
  NotificationChannelResult,
  NotificationSend,
  NotificationSendResult,
  ReminderDelivery,
} from "./types.js";

export interface ReminderStore {
  dueReminders(now?: Date, limit?: number): Promise<DueReminder[]>;
  claimReminder(
    itemId: string,
    reminderAt: Date,
    attemptedAt?: Date,
    signal?: AbortSignal
  ): Promise<ReminderDelivery | null>;
  finishReminder(
    id: string,
    input: {
      status: "sent" | "failed";
      channelResults: NotificationSendResult["channels"] | null;
      failure: string | null;
    },
    completedAt?: Date
  ): Promise<ReminderDelivery>;
}

export interface ReminderPollResult {
  due: number;
  claimed: number;
  sent: number;
  failed: number;
  deduplicated: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function validChannelResult(value: unknown): value is NotificationChannelResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return result.status === "sent" ||
    result.status === "disabled" ||
    (result.status === "failed" && typeof result.error === "string");
}

function validateNotificationResult(value: unknown): NotificationSendResult {
  if (!value || typeof value !== "object") {
    throw new Error("notifications.send returned an invalid result");
  }
  const channels = (value as { channels?: unknown }).channels;
  if (!channels || typeof channels !== "object") {
    throw new Error("notifications.send returned an invalid channels result");
  }
  const record = channels as Record<string, unknown>;
  if (!validChannelResult(record.mac) || !validChannelResult(record.ntfy)) {
    throw new Error("notifications.send must return mac and ntfy channel results");
  }
  return {
    channels: { mac: record.mac, ntfy: record.ntfy },
  };
}

function resultOutcome(result: NotificationSendResult): {
  status: "sent" | "failed";
  failure: string | null;
} {
  const entries = Object.entries(result.channels) as Array<
    ["mac" | "ntfy", NotificationChannelResult]
  >;
  const sent = entries.some(([, channel]) => channel.status === "sent");
  const details = entries.flatMap(([name, channel]) => {
    if (channel.status === "failed") return [`${name}: ${channel.error}`];
    if (channel.status === "disabled") return [`${name}: disabled`];
    return [];
  });
  return {
    status: sent ? "sent" : "failed",
    failure: details.length ? details.join("; ") : null,
  };
}

function formatWallTime(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return String(instant);
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  if (!year || !month || !day || !hour || !minute || !second) {
    return String(instant);
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function notificationSchedule(item: DueReminder["item"]): string {
  try {
    return `${formatWallTime(item.scheduledStartAt, item.timezone)} (${item.timezone})`;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return `${formatWallTime(item.scheduledStartAt, "UTC")} (UTC; invalid timezone ${item.timezone})`;
  }
}

function notificationMessage(reminder: DueReminder): string {
  const item = reminder.item;
  const description = item.description?.trim();
  return [
    `Scheduled for ${notificationSchedule(item)}.`,
    description || null,
    "Open EchoLog or use el schedule confirm to start explicitly.",
  ].filter(Boolean).join("\n");
}

export async function pollDueReminders(
  store: ReminderStore,
  send: NotificationSend,
  signal: AbortSignal,
  options: { now?: Date; limit?: number } = {}
): Promise<ReminderPollResult> {
  signal.throwIfAborted();
  const now = options.now ?? new Date();
  const due = await store.dueReminders(now, options.limit ?? 100);
  const summary: ReminderPollResult = {
    due: due.length,
    claimed: 0,
    sent: 0,
    failed: 0,
    deduplicated: 0,
  };

  for (const reminder of due) {
    signal.throwIfAborted();
    const claimed = await store.claimReminder(
      reminder.item.id,
      reminder.reminderAt,
      now,
      signal
    );
    signal.throwIfAborted();
    if (!claimed) {
      summary.deduplicated++;
      continue;
    }
    summary.claimed++;

    let result: NotificationSendResult;
    try {
      signal.throwIfAborted();
      const sendResult = await send({
        title: `Schedule reminder: ${reminder.item.title}`,
        message: notificationMessage(reminder),
      }, signal);
      signal.throwIfAborted();
      result = validateNotificationResult(sendResult);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error;
      signal.throwIfAborted();
      await store.finishReminder(claimed.id, {
        status: "failed",
        channelResults: null,
        failure: errorMessage(error),
      }, new Date());
      summary.failed++;
      continue;
    }
    const outcome = resultOutcome(result);
    signal.throwIfAborted();
    await store.finishReminder(claimed.id, {
      status: outcome.status,
      channelResults: result.channels,
      failure: outcome.failure,
    }, new Date());
    summary[outcome.status]++;
  }
  return summary;
}
