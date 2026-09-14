import {
  getMessaging,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';
import { Platform } from 'react-native';

import {
  describeNotificationPermissionStatus,
  getNotificationPermissions,
  type GetNotificationPermissionsOptions,
  isNotificationPermissionGranted,
} from './permissions';
import {
  getSupportedPlatform,
  type SupportedPlatform,
} from '../internal/platform';
import {
  getRequiredNonEmptyStringFromSource,
} from '../internal/validation';
import {
  failWithBubblesError,
  getErrorMessage,
} from '../internal/errors';

export type { SupportedPlatform } from '../internal/platform';
export type NativeTokenType = 'fcm';

export type GetDeviceTokenOptions = GetNotificationPermissionsOptions;

export interface DeviceTokenResult {
  platform: SupportedPlatform;
  tokenType: NativeTokenType;
  token: string;
}

export interface DeviceRegistrationState {
  platform: SupportedPlatform;
  tokenType: NativeTokenType | null;
  token: string | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
}

async function getFirebaseMessagingToken(
  platform: SupportedPlatform,
): Promise<string> {
  try {
    const messagingInstance = getMessaging();

    if (!isDeviceRegisteredForRemoteMessages(messagingInstance)) {
      await registerDeviceForRemoteMessages(messagingInstance);
    }

    const token = await getToken(messagingInstance);

    return getRequiredNonEmptyStringFromSource(
      token,
      `${platform} FCM token from Firebase Messaging`,
    );
  } catch (error) {
    const reason = getErrorMessage(error);
    const platformSpecificSetupHint =
      platform === 'ios'
        ? ' On iOS, also ensure Firebase APNs setup is complete and `expo.ios.googleServicesFile` is configured.'
        : ' On Android, ensure `google-services.json` is configured and the native app has been rebuilt.';

    failWithBubblesError(
      `Failed to get a ${platform} FCM token from Firebase Messaging. Ensure "@react-native-firebase/app" and "@react-native-firebase/messaging" are installed, the Expo app includes the "@react-native-firebase/messaging" config plugin, and Firebase is configured for this platform.${platformSpecificSetupHint} Original error: ${reason}`,
    );
  }
}

export async function getDeviceRegistrationState(
  options?: GetDeviceTokenOptions,
): Promise<DeviceRegistrationState> {
  const platform = getSupportedPlatform(Platform.OS);
  const permissions = await getNotificationPermissions(options);
  const permissionStatus = describeNotificationPermissionStatus(permissions);
  const notificationsEnabled = isNotificationPermissionGranted(permissions);

  if (!notificationsEnabled) {
    return {
      platform,
      tokenType: null,
      token: null,
      permissionStatus,
      notificationsEnabled: false,
    };
  }

  const token = await getFirebaseMessagingToken(platform);

  return {
    platform,
    tokenType: 'fcm',
    token,
    permissionStatus,
    notificationsEnabled: true,
  };
}

export async function getDeviceToken(
  options?: GetDeviceTokenOptions,
): Promise<DeviceTokenResult> {
  const registrationState = await getDeviceRegistrationState(options);

  if (!registrationState.notificationsEnabled || !registrationState.token) {
    failWithBubblesError('Push notification permission was not granted.');
  }

  return {
    platform: registrationState.platform,
    tokenType: 'fcm',
    token: registrationState.token,
  };
}

export async function getFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  const tokenResult = await getDeviceToken(options);
  return tokenResult.token;
}
