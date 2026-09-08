import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  getBubblesNotificationsRuntimeConfig,
  type AndroidChannelImportance,
} from '../config/runtime-config';

const ANDROID_CHANNEL_IMPORTANCE_MAP: Record<
  AndroidChannelImportance,
  Notifications.AndroidImportance
> = {
  min: Notifications.AndroidImportance.MIN,
  low: Notifications.AndroidImportance.LOW,
  default: Notifications.AndroidImportance.DEFAULT,
  high: Notifications.AndroidImportance.HIGH,
  max: Notifications.AndroidImportance.MAX,
};

export interface EnsureDefaultNotificationChannelOptions {
  channelId?: string;
  channelName?: string;
  importance?: AndroidChannelImportance;
}

export interface DefaultNotificationChannelConfig {
  channelId: string;
  channelName: string;
  importance: AndroidChannelImportance;
}

function fail(message: string): never {
  throw new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

function getRequiredNonEmptyString(
  value: string | undefined,
  fieldName: string,
): string {
  if (typeof value !== 'string') {
    fail(`"${fieldName}" must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    fail(`"${fieldName}" must not be empty.`);
  }

  return trimmedValue;
}

export function getAndroidNotificationChannelImportance(
  value: AndroidChannelImportance,
): Notifications.AndroidImportance {
  return ANDROID_CHANNEL_IMPORTANCE_MAP[value];
}

export function getDefaultNotificationChannelConfig(
  options?: EnsureDefaultNotificationChannelOptions,
): DefaultNotificationChannelConfig {
  const runtimeConfig = getBubblesNotificationsRuntimeConfig();

  return {
    channelId: getRequiredNonEmptyString(
      options?.channelId ?? runtimeConfig.defaultChannelId,
      'channelId',
    ),
    channelName: getRequiredNonEmptyString(
      options?.channelName ?? runtimeConfig.defaultChannelName,
      'channelName',
    ),
    importance: options?.importance ?? runtimeConfig.androidChannelImportance,
  };
}

export async function ensureDefaultNotificationChannel(
  options?: EnsureDefaultNotificationChannelOptions,
): Promise<Notifications.NotificationChannel | null> {
  if (Platform.OS !== 'android') {
    return null;
  }

  const channelConfig = getDefaultNotificationChannelConfig(options);

  return Notifications.setNotificationChannelAsync(channelConfig.channelId, {
    name: channelConfig.channelName,
    importance: getAndroidNotificationChannelImportance(channelConfig.importance),
  });
}
