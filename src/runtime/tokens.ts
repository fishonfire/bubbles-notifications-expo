import { Platform } from 'react-native';
import {
  getMessaging,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';

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
import { getBubblesNotificationsRuntimeConfig } from '../config/runtime-config';

export type { SupportedPlatform } from '../internal/platform';
export type NativeTokenType = 'fcm' | 'fid';

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
  fid: string | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
}

async function getFirebaseMessagingToken(): Promise<string> {
  const messagingInstance = getMessaging();

  if (!isDeviceRegisteredForRemoteMessages(messagingInstance)) {
    await registerDeviceForRemoteMessages(messagingInstance);
  }

  const token = (await getToken(messagingInstance)).trim();

  if (!token) {
    failWithBubblesError(
      'Firebase Messaging token from Firebase Messaging must not be empty.',
    );
  }

  return token;
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
      fid: null,
      permissionStatus,
      notificationsEnabled: false,
    };
  }

  const fid = await getFirebaseInstallationId(platform);

  if (
    getBubblesNotificationsRuntimeConfig()
      .enableFirebaseInstallationPushRegistration
  ) {
    return {
      platform,
      tokenType: 'fid',
      token: fid,
      fid,
      permissionStatus,
      notificationsEnabled: true,
    };
  }

  const token = await getFirebaseMessagingToken();

  return {
    platform,
    tokenType: 'fcm',
    token,
    fid,
    permissionStatus,
    notificationsEnabled: true,
  };
}

export async function getDeviceToken(
  options?: GetDeviceTokenOptions,
): Promise<DeviceTokenResult> {
  const registrationState = await getDeviceRegistrationState(options);

  if (
    !registrationState.notificationsEnabled ||
    !registrationState.token ||
    !registrationState.tokenType
  ) {
    failWithBubblesError('Push notification permission was not granted.');
  }

  return {
    platform: registrationState.platform,
    tokenType: registrationState.tokenType,
    token: registrationState.token,
  };
}

export async function getFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  const tokenResult = await getDeviceToken(options);
  return tokenResult.token;
}
