import { z } from 'zod';

/**
 * Settings > Notifications: which emails the signed-in person gets about the
 * active shop. Each person keeps their own switches per shop; one who has
 * never toggled any reads as NOTIFICATION_DEFAULTS.
 */

/** GET and PATCH /settings/notifications. */
export const notificationSettingsSchema = z.object({
  /** An email for every order the assistant drafts. */
  newOrder: z.boolean(),
  /** An email when a chat is handed to the seller and nobody has replied in 10 minutes. */
  customerWaiting: z.boolean(),
  /** An email at 9:00 shop time with yesterday's orders and revenue. */
  dailySummary: z.boolean(),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const NOTIFICATION_DEFAULTS: NotificationSettings = {
  newOrder: true,
  customerWaiting: true,
  dailySummary: false,
};

/** One of the switches; what the sender asks for recipients of. */
export type NotificationKind = keyof NotificationSettings;

/** PATCH /settings/notifications. Omit a switch to leave it alone. */
export const updateNotificationSettingsSchema = notificationSettingsSchema.partial().strict();
export type UpdateNotificationSettings = z.infer<typeof updateNotificationSettingsSchema>;
