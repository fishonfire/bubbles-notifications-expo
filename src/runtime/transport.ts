import { getFirebaseInstallationId } from './installations';
import {
  getDeviceRegistrationState,
  getDeviceToken,
  getFCMToken,
  type DeviceRegistrationState,
  type DeviceTokenResult,
  type GetDeviceTokenOptions,
  type NativeTokenType,
  type SupportedPlatform,
} from './tokens';

export type {
  DeviceRegistrationState,
  DeviceTokenResult,
  GetDeviceTokenOptions,
  NativeTokenType,
  SupportedPlatform,
};

export function observeBubblesForegroundRemoteMessages(): () => void {
  let isCancelled = false;
  let unsubscribe: (() => void) | null = null;

  void import('./foreground-message-observer')
    .then(({ observeBubblesForegroundMessages }) => {
      if (isCancelled) {
        return;
      }

      unsubscribe = observeBubblesForegroundMessages();

      if (isCancelled) {
        unsubscribe();
      }
    })
    .catch((error) => {
      console.error(
        '[@fishonfire/bubbles-expo] Failed to start Firebase foreground message observer.',
        error,
      );
    });

  return () => {
    isCancelled = true;

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export function observeBubblesDeviceTokenRefresh(
  listener: (token: string) => void,
): () => void {
  let isCancelled = false;
  let unsubscribe: (() => void) | null = null;

  void import('@react-native-firebase/messaging')
    .then(({ getMessaging, onTokenRefresh }) => {
      if (isCancelled) {
        return;
      }

      unsubscribe = onTokenRefresh(getMessaging(), listener);

      if (isCancelled) {
        unsubscribe();
      }
    })
    .catch((error) => {
      console.error(
        '[@fishonfire/bubbles-expo] Failed to observe Firebase token refreshes.',
        error,
      );
    });

  return () => {
    isCancelled = true;

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export async function getBubblesDeviceRegistrationState(
  options?: GetDeviceTokenOptions,
): Promise<DeviceRegistrationState> {
  return getDeviceRegistrationState(options);
}

export async function getBubblesDeviceToken(
  options?: GetDeviceTokenOptions,
): Promise<DeviceTokenResult> {
  return getDeviceToken(options);
}

export async function getBubblesFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  return getFCMToken(options);
}

export async function getBubblesInstallationId(
  platform: SupportedPlatform,
): Promise<string> {
  return getFirebaseInstallationId(platform);
}
