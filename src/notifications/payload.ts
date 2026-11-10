import type { Notification } from 'expo-notifications'

export interface BubblesNotificationDataContract {
  notification_id: string;
  url?: string;
  type?: string;
  resource_id?: string;
  message_title?: string;
  body?: string;
  source?: string;
  message_id?: string;
  campaign_id?: string;
  [key: string]: string | undefined;
}

export interface BubblesVisibleNotificationPayloadContract {
  notification: {
    title: string;
    body: string;
  };
  data: BubblesNotificationDataContract;
}

export interface BubblesSilentNotificationPayloadContract {
  data: BubblesNotificationDataContract;
}

export type BubblesForegroundNotificationPayloadContract =
  BubblesVisibleNotificationPayloadContract

export interface BubblesNotificationPayload {
  data: Record<string, unknown>;
  notificationId: string | null;
  messageTitle: string | null;
  body: string | null;
  source: string | null;
  messageId: string | null;
  campaignId: string | null;
  url: string | null;
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getOptionalNonEmptyString (value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()

  return trimmedValue.length > 0 ? trimmedValue : null
}

function getOptionalIdentifier (value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }

  return getOptionalNonEmptyString(value)
}

export function getBubblesNotificationData (
  value: unknown
): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

export function getBubblesNotificationDataFromNotification (
  notification: Notification
): Record<string, unknown> {
  const data = getBubblesNotificationData(notification.request.content.data)
  const trigger = notification.request.trigger

  if (getOptionalIdentifier(data.notification_id) !== null) {
    return data
  }

  // Expo exposes flat FCM/APNs custom fields in the iOS push trigger payload,
  // while content.data may be empty because it expects an Expo-style body object.
  if (trigger && 'type' in trigger && trigger.type === 'push') {
    const payload = getBubblesNotificationData(trigger.payload)

    if (getOptionalIdentifier(payload.notification_id) !== null) {
      return payload
    }
  }

  return data
}

export function normalizeBubblesNotificationPayload (
  value: unknown
): BubblesNotificationPayload {
  const data = getBubblesNotificationData(value)

  return {
    data,
    notificationId: getOptionalIdentifier(data.notification_id),
    messageTitle: getOptionalNonEmptyString(data.message_title),
    body: getOptionalNonEmptyString(data.body),
    source: getOptionalNonEmptyString(data.source),
    messageId: getOptionalIdentifier(data.message_id),
    campaignId: getOptionalIdentifier(data.campaign_id),
    url: getOptionalNonEmptyString(data.url)
  }
}
