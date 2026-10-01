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
import { failWithBubblesError } from '../internal/errors';
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

  const token = await getFirebaseInstallationId(platform);

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
