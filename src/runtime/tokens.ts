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
  failWithBubblesError,
  getErrorMessage,
} from '../internal/errors';
import { getFirebaseInstallationId } from './installations';

export type { SupportedPlatform } from '../internal/platform';
export type NativeTokenType = 'fid';

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

async function getFirebaseMessagingInstallationId(
  platform: SupportedPlatform,
): Promise<string> {
  try {
    return await getFirebaseInstallationId(platform);
  } catch (error) {
    const reason = getErrorMessage(error);
    const platformSpecificSetupHint =
      platform === 'ios'
        ? ' On iOS, also ensure Firebase APNs setup is complete and `expo.ios.googleServicesFile` is configured.'
        : ' On Android, ensure `expo.android.googleServicesFile` is configured and the native app has been rebuilt.';

    failWithBubblesError(
      `Failed to get a ${platform} Firebase installation id for push registration. Ensure "@react-native-firebase/app" and "@react-native-firebase/installations" are installed and Firebase is configured for this platform.${platformSpecificSetupHint} Original error: ${reason}`,
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

  const token = await getFirebaseMessagingInstallationId(platform);

  return {
    platform,
    tokenType: 'fid',
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
    tokenType: 'fid',
    token: registrationState.token,
  };
}

export async function getFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  const tokenResult = await getDeviceToken(options);
  return tokenResult.token;
}
