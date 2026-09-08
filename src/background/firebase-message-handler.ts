import {
  getMessaging,
  setBackgroundMessageHandler,
} from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { BUBBLES_DELIVERY_STATUSES } from '../api/delivery-status';
import { getErrorMessage } from '../internal/errors';
import { postStoredBubblesDeliveryStatus } from '../notifications/delivery-status';
import {
  scheduleBubblesLocalNotification,
} from '../notifications/local-notification';
import {
  getBubblesNotificationPayloadFromRemoteMessage,
  hasFirebaseDisplayNotification,
} from '../notifications/remote-message';
import { isNotificationPermissionGranted } from '../runtime/permissions';

type FirebaseBackgroundMessageHandler = Parameters<
  typeof setBackgroundMessageHandler
>[1];
type BackgroundDeliveryStatus =
  (typeof BUBBLES_DELIVERY_STATUSES)[keyof typeof BUBBLES_DELIVERY_STATUSES];

const BACKGROUND_NOTIFICATION_SOURCE = 'Firebase background message';
const DEFAULT_BACKGROUND_NOTIFICATION_TITLE =
  'Background notification received';
const DEFAULT_BACKGROUND_NOTIFICATION_BODY =
  'Open the app to view this update.';

function supportsFirebaseBackgroundMessages(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

function supportsBackgroundLocalNotificationPresentation(): boolean {
  return Platform.OS === 'android';
}

function logBackgroundStatusError(
  description: string,
  error: unknown,
) {
  console.error(
    `[@fishonfire/bubbles-expo] Failed to post ${BACKGROUND_NOTIFICATION_SOURCE} ${description} delivery status.`,
    error,
  );
}

function getBackgroundNotificationErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to show notification';
  }

  return `Failed to show notification: ${getErrorMessage(error)}`;
}

async function postBackgroundDeliveryStatus(
  notificationId: string | null,
  status: BackgroundDeliveryStatus,
) {
  try {
    await postStoredBubblesDeliveryStatus({
      source: BACKGROUND_NOTIFICATION_SOURCE,
      notificationId,
      status,
    });
  } catch (error) {
    logBackgroundStatusError(status, error);
  }
}

async function postBackgroundDeliveryError(
  notificationId: string | null,
  errorMessage: string,
) {
  try {
    await postStoredBubblesDeliveryStatus({
      source: BACKGROUND_NOTIFICATION_SOURCE,
      notificationId,
      error: errorMessage,
    });
  } catch (error) {
    logBackgroundStatusError('error', error);
  }
}

function postBackgroundNotificationReceived(notificationId: string | null) {
  return postBackgroundDeliveryStatus(
    notificationId,
    BUBBLES_DELIVERY_STATUSES.notificationReceived,
  );
}

function postBackgroundNotificationsDisabled(notificationId: string | null) {
  return postBackgroundDeliveryStatus(
    notificationId,
    BUBBLES_DELIVERY_STATUSES.notificationsDisabled,
  );
}

let hasRegisteredFirebaseBackgroundMessageHandler = false;

const handleBubblesFirebaseBackgroundMessage: FirebaseBackgroundMessageHandler =
  async (remoteMessage) => {
    const payload =
      getBubblesNotificationPayloadFromRemoteMessage(remoteMessage);

    const permissions = await Notifications.getPermissionsAsync();
    const notificationsEnabled =
      isNotificationPermissionGranted(permissions);

    if (!notificationsEnabled) {
      await postBackgroundNotificationsDisabled(payload.notificationId);
      return;
    }

    await postBackgroundNotificationReceived(payload.notificationId);

    if (hasFirebaseDisplayNotification(remoteMessage)) {
      return;
    }

    if (!supportsBackgroundLocalNotificationPresentation()) {
      return;
    }

    try {
      const scheduledNotificationId =
        await scheduleBubblesLocalNotification({
          source: BACKGROUND_NOTIFICATION_SOURCE,
          payload,
          title: DEFAULT_BACKGROUND_NOTIFICATION_TITLE,
          body: DEFAULT_BACKGROUND_NOTIFICATION_BODY,
          skipPermissionCheck: true,
        });

      if (scheduledNotificationId === null) {
        return;
      }
    } catch (error) {
      await postBackgroundDeliveryError(
        payload.notificationId,
        getBackgroundNotificationErrorMessage(error),
      );
      throw error;
    }

  };

export function registerBubblesFirebaseBackgroundMessageHandler(): void {
  if (hasRegisteredFirebaseBackgroundMessageHandler) {
    return;
  }

  if (!supportsFirebaseBackgroundMessages()) {
    return;
  }

  try {
    setBackgroundMessageHandler(
      getMessaging(),
      handleBubblesFirebaseBackgroundMessage,
    );
    hasRegisteredFirebaseBackgroundMessageHandler = true;
  } catch (error) {
    console.error(
      '[@fishonfire/bubbles-expo] Failed to register Firebase background message handler.',
      error,
    );
  }
}
