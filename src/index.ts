import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type SupportedPlatform = 'android' | 'ios';
export type NativeTokenType = 'fcm' | 'apns';
export type PermissionRequestOptions = Parameters<
  typeof Notifications.requestPermissionsAsync
>[0];

export interface GetDeviceTokenOptions {
  requestPermissions?: boolean;
  permissionRequestOptions?: PermissionRequestOptions;
}

export interface DeviceTokenResult {
  platform: SupportedPlatform;
  tokenType: NativeTokenType;
  token: string;
}

function getCurrentPlatform(): SupportedPlatform {
  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    return Platform.OS;
  }

  throw new Error(
    `Unsupported platform: ${Platform.OS}. This package only supports iOS and Android.`,
  );
}

async function ensureNotificationPermissions(
  options?: GetDeviceTokenOptions,
): Promise<void> {
  if (options?.requestPermissions === false) {
    return;
  }

  const existingPermissions = await Notifications.getPermissionsAsync();

  if (existingPermissions.granted) {
    return;
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync(
    options?.permissionRequestOptions,
  );

  if (!requestedPermissions.granted) {
    throw new Error('Push notification permission was not granted.');
  }
}

export async function getDeviceToken(
  options?: GetDeviceTokenOptions,
): Promise<DeviceTokenResult> {
  const platform = getCurrentPlatform();

  await ensureNotificationPermissions(options);

  const nativeToken = await Notifications.getDevicePushTokenAsync();

  return {
    platform,
    tokenType: platform === 'android' ? 'fcm' : 'apns',
    token: nativeToken.data,
  };
}

export async function getFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  const platform = getCurrentPlatform();

  if (platform === 'ios') {
    throw new Error(
      'expo-notifications returns an APNs token on iOS, not an FCM token. Use a Firebase Messaging native integration if you need the iOS FCM registration token.',
    );
  }

  const tokenResult = await getDeviceToken(options);
  return tokenResult.token;
}
