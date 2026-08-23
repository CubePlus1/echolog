export type ScheduleStatus = "scheduled" | "active" | "done" | "cancelled";

export interface ScheduleItem {
  id: string;
  title: string;
  description: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  timezone: string;
  priority: number;
  status: ScheduleStatus;
  nextReminderAt: string | null;
  confirmedStartAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  awaitingConfirmation: boolean;
}

export interface CreateScheduleItemInput {
  title: string;
  description: string | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date | null;
  timezone: string;
  priority: number;
  nextReminderAt: Date | null;
}

export interface EditScheduleItemInput {
  title?: string;
  description?: string | null;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date | null;
  timezone?: string;
  priority?: number;
  nextReminderAt?: Date | null;
}

export type NotificationChannelResult =
  | { status: "sent" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

export interface NotificationSendResult {
  channels: Record<"mac" | "ntfy", NotificationChannelResult>;
}

/** Package-local consumer mirror of the Host's notifications.send contract. */
export type NotificationSend = (
  request: { title: string; message: string },
  signal?: AbortSignal
) => Promise<NotificationSendResult>;

export type ReminderDeliveryStatus = "claimed" | "sent" | "failed";

export interface ReminderDelivery {
  id: string;
  dedupeKey: string;
  itemId: string;
  reminderAt: string;
  attemptedAt: string;
  completedAt: string | null;
  status: ReminderDeliveryStatus;
  channelResults: NotificationSendResult["channels"] | null;
  failure: string | null;
}

export interface ScheduleConflictMetadata {
  currentVersion: number;
  currentStatus: ScheduleStatus;
}
