import type { RemoteMessage } from '@react-native-firebase/messaging';

import {
  getBubblesNotificationData,
  normalizeBubblesNotificationPayload,
  type BubblesNotificationPayload,
} from './payload';

function getOptionalNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getBubblesNotificationPayloadFromRemoteMessage(
  remoteMessage: RemoteMessage,
): BubblesNotificationPayload {
  const payload = normalizeBubblesNotificationPayload(
    getBubblesNotificationData(remoteMessage.data),
  );

  return {
    ...payload,
    messageTitle:
      payload.messageTitle ??
      getOptionalNonEmptyString(remoteMessage.notification?.title),
    body:
      payload.body ??
      getOptionalNonEmptyString(remoteMessage.notification?.body),
  };
}

export function hasFirebaseDisplayNotification(
  remoteMessage: RemoteMessage,
): boolean {
  return (
    getOptionalNonEmptyString(remoteMessage.notification?.title) !==
      null ||
    getOptionalNonEmptyString(remoteMessage.notification?.body) !==
      null
  );
}
