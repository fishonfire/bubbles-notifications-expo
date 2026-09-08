import {
  getMessaging,
  onMessage,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

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

async function handleFirebaseForegroundMessage(
  remoteMessage: RemoteMessage,
): Promise<void> {
  const payload =
    getBubblesNotificationPayloadFromRemoteMessage(remoteMessage);

  if (!hasFirebaseDisplayNotification(remoteMessage)) {
    return;
  }

  await scheduleBubblesLocalNotification({
    source: 'Firebase foreground message',
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
