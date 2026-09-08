import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensureDefaultNotificationChannel } from './channels';
import { failWithBubblesError } from '../internal/errors';
import { assertSupportedPlatform } from '../internal/platform';

const IOS_GRANTED_AUTHORIZATION_STATUSES = new Set([
  Notifications.IosAuthorizationStatus.AUTHORIZED,
  Notifications.IosAuthorizationStatus.PROVISIONAL,
  Notifications.IosAuthorizationStatus.EPHEMERAL,
]);

export type PermissionRequestOptions = Parameters<
  typeof Notifications.requestPermissionsAsync
>[0];

export interface GetNotificationPermissionsOptions {
  requestPermissions?: boolean;
  permissionRequestOptions?: PermissionRequestOptions;
}

export function isNotificationPermissionGranted(
  permissions: Notifications.NotificationPermissionsStatus,
): boolean {
  if (Platform.OS === 'ios' && permissions.ios?.status != null) {
    return IOS_GRANTED_AUTHORIZATION_STATUSES.has(permissions.ios.status);
  }

  return permissions.granted;
}

export function describeNotificationPermissionStatus(
  permissions: Notifications.NotificationPermissionsStatus,
): string {
  if (Platform.OS === 'ios' && permissions.ios?.status != null) {
    return Notifications.IosAuthorizationStatus[permissions.ios.status].toLowerCase();
  }

  return permissions.status;
}

export async function getNotificationPermissions(
  options?: GetNotificationPermissionsOptions,
): Promise<Notifications.NotificationPermissionsStatus> {
  assertSupportedPlatform(Platform.OS);

  await ensureDefaultNotificationChannel();

  const existingPermissions = await Notifications.getPermissionsAsync();

  if (
    isNotificationPermissionGranted(existingPermissions) ||
    options?.requestPermissions === false
  ) {
    return existingPermissions;
  }

  return Notifications.requestPermissionsAsync(options?.permissionRequestOptions);
}

export async function ensureNotificationPermissions(
  options?: GetNotificationPermissionsOptions,
): Promise<Notifications.NotificationPermissionsStatus> {
  const permissions = await getNotificationPermissions(options);

  if (!isNotificationPermissionGranted(permissions)) {
    failWithBubblesError('Push notification permission was not granted.');
  }

  return permissions;
}
