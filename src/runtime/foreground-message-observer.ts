import {
  getMessaging,
  onMessage,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

import {
  observeStoredBubblesNotificationReceived,
} from '../notifications/delivery-status';
import {
  scheduleBubblesLocalNotification,
} from '../notifications/local-notification';
import {
  getBubblesNotificationPayloadFromRemoteMessage,
  hasFirebaseDisplayNotification,
} from '../notifications/remote-message';

function supportsFirebaseForegroundMessages(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

const FOREGROUND_NOTIFICATION_SOURCE = 'Firebase foreground message';

async function observeForegroundNotificationReceived(
  notificationId: string | null,
) {
  try {
    await observeStoredBubblesNotificationReceived({
      source: FOREGROUND_NOTIFICATION_SOURCE,
      notificationId,
    });
  } catch (error) {
    console.error(
      `[@fishonfire/bubbles-expo] Failed to post ${FOREGROUND_NOTIFICATION_SOURCE} received delivery status.`,
      error,
    );
  }
}

async function handleFirebaseForegroundMessage(
  remoteMessage: RemoteMessage,
): Promise<void> {
  const payload =
    getBubblesNotificationPayloadFromRemoteMessage(remoteMessage);

  await observeForegroundNotificationReceived(payload.notificationId);

  if (!hasFirebaseDisplayNotification(remoteMessage)) {
    return;
  }

  await scheduleBubblesLocalNotification({
    source: FOREGROUND_NOTIFICATION_SOURCE,
    payload,
  });
}

export function observeBubblesForegroundMessages(): () => void {
  if (!supportsFirebaseForegroundMessages()) {
    return () => {};
  }

  const unsubscribe = onMessage(
    getMessaging(),
    (remoteMessage) => {
      void handleFirebaseForegroundMessage(remoteMessage).catch(
        (error) => {
          console.error(
            '[@fishonfire/bubbles-expo] Failed while handling a Firebase foreground message.',
            error,
          );
        },
      );
    },
  );

  return () => {
    unsubscribe();
  };
}
