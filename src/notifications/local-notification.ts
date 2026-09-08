import * as Notifications from 'expo-notifications';

import { BUBBLES_DELIVERY_STATUSES } from '../api/delivery-status';
import { postStoredBubblesDeliveryStatus } from './delivery-status';
import { isNotificationPermissionGranted } from '../runtime/permissions';

import type { BubblesNotificationPayload } from './payload';

const DEFAULT_LOCAL_NOTIFICATION_TITLE = 'Notification received';
const DEFAULT_LOCAL_NOTIFICATION_BODY =
  'Open the app to view this update.';
const DUPLICATE_NOTIFICATION_WINDOW_MS = 5_000;

const recentlyScheduledNotificationKeys = new Map<string, number>();

export interface BuildBubblesLocalNotificationRequestOptions {
  title?: string | null;
  body?: string | null;
}

export interface ScheduleBubblesLocalNotificationOptions
  extends BuildBubblesLocalNotificationRequestOptions {
  source: string;
  payload: BubblesNotificationPayload;
  skipPermissionCheck?: boolean;
}

function getOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function buildDuplicateNotificationKey(
  payload: BubblesNotificationPayload,
): string | null {
  if (payload.notificationId) {
    return `notification:${payload.notificationId}`;
  }

  const dataKeys = Object.keys(payload.data);

  if (dataKeys.length === 0) {
    return null;
  }

  try {
    return `data:${JSON.stringify(payload.data)}`;
  } catch {
    return null;
  }
}

function rememberScheduledNotificationKey(
  duplicateKey: string,
): boolean {
  const now = Date.now();

  for (const [key, timestamp] of recentlyScheduledNotificationKeys) {
    if (now - timestamp > DUPLICATE_NOTIFICATION_WINDOW_MS) {
      recentlyScheduledNotificationKeys.delete(key);
    }
  }

  const previousTimestamp =
    recentlyScheduledNotificationKeys.get(duplicateKey);

  if (
    previousTimestamp !== undefined &&
    now - previousTimestamp <= DUPLICATE_NOTIFICATION_WINDOW_MS
  ) {
    return false;
  }

  recentlyScheduledNotificationKeys.set(duplicateKey, now);
  return true;
}

async function postLocalNotificationShownDeliveryStatus(
  options: ScheduleBubblesLocalNotificationOptions,
) {
  try {
    await postStoredBubblesDeliveryStatus({
      source: options.source,
      notificationId: options.payload.notificationId,
      status: BUBBLES_DELIVERY_STATUSES.notificationShown,
    });
  } catch (error) {
    console.error(
      `[@fishonfire/bubbles-expo] Failed to post ${options.source} shown delivery status.`,
      error,
    );
  }
}

export function buildBubblesLocalNotificationRequest(
  payload: BubblesNotificationPayload,
  options?: BuildBubblesLocalNotificationRequestOptions,
): Parameters<typeof Notifications.scheduleNotificationAsync>[0] {
  return {
    content: {
      title:
        payload.messageTitle ??
        getOptionalNonEmptyString(options?.title) ??
        DEFAULT_LOCAL_NOTIFICATION_TITLE,
      body:
        payload.body ??
        getOptionalNonEmptyString(options?.body) ??
        DEFAULT_LOCAL_NOTIFICATION_BODY,
      data: payload.data,
    },
    // Force app to trigger it 1 second from now instead of null.
    // This prevents issues during background handling.
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
    },
  };
}

export async function scheduleBubblesLocalNotification(
  options: ScheduleBubblesLocalNotificationOptions,
): Promise<string | null> {
  if (!options.skipPermissionCheck) {
    const permissions = await Notifications.getPermissionsAsync();
    const notificationsEnabled =
      isNotificationPermissionGranted(permissions);

    if (!notificationsEnabled) {
      return null;
    }
  }

  const duplicateKey = buildDuplicateNotificationKey(options.payload);

  if (
    duplicateKey !== null &&
    !rememberScheduledNotificationKey(duplicateKey)
  ) {
    return null;
  }

  const notificationRequest = buildBubblesLocalNotificationRequest(
    options.payload,
    options,
  );

  const scheduledNotificationId =
    await Notifications.scheduleNotificationAsync(
      notificationRequest,
    );

  await postLocalNotificationShownDeliveryStatus(options);

  return scheduledNotificationId;
}
