import Constants from 'expo-constants';

import {
  ANDROID_CHANNEL_IMPORTANCE_VALUES as SHARED_ANDROID_CHANNEL_IMPORTANCE_VALUES,
  BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY as SHARED_BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY,
} from '../../plugin/src/shared-config';
import { failWithBubblesError } from '../internal/errors';
import {
  getRequiredNonEmptyString,
  isPlainObject,
} from '../internal/validation';

export const BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY =
  SHARED_BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY;

export const ANDROID_CHANNEL_IMPORTANCE_VALUES =
  SHARED_ANDROID_CHANNEL_IMPORTANCE_VALUES;

export type AndroidChannelImportance =
  (typeof ANDROID_CHANNEL_IMPORTANCE_VALUES)[number];

export interface BubblesNotificationsRuntimeConfig {
  defaultChannelId: string;
  defaultChannelName: string;
  androidChannelImportance: AndroidChannelImportance;
}

function getAndroidChannelImportance(
  value: unknown,
  propertyPath: string,
): AndroidChannelImportance {
  if (typeof value !== 'string') {
    failWithBubblesError(
      `"${propertyPath}" must be one of: ${ANDROID_CHANNEL_IMPORTANCE_VALUES.join(
        ', ',
      )}.`,
    );
  }

  if (
    !ANDROID_CHANNEL_IMPORTANCE_VALUES.includes(
      value as AndroidChannelImportance,
    )
  ) {
    failWithBubblesError(
      `"${propertyPath}" must be one of: ${ANDROID_CHANNEL_IMPORTANCE_VALUES.join(
        ', ',
      )}.`,
    );
  }

  return value as AndroidChannelImportance;
}

export function getBubblesNotificationsRuntimeConfig(): BubblesNotificationsRuntimeConfig {
  const expoConfig = Constants.expoConfig;

  if (!expoConfig) {
    failWithBubblesError(
      'Expo runtime config is unavailable. Ensure the app is running with Expo config support.',
    );
  }

  if (!isPlainObject(expoConfig.extra)) {
    failWithBubblesError(
      `Missing "expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}". Configure the "@fishonfire/bubbles-expo" plugin in app.json.`,
    );
  }

  const runtimeConfig =
    expoConfig.extra[BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY];

  if (!isPlainObject(runtimeConfig)) {
    failWithBubblesError(
      `Missing "expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}". Configure the "@fishonfire/bubbles-expo" plugin in app.json.`,
    );
  }

  return {
    defaultChannelId: getRequiredNonEmptyString(
      runtimeConfig.defaultChannelId,
      `expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}.defaultChannelId`,
    ),
    defaultChannelName: getRequiredNonEmptyString(
      runtimeConfig.defaultChannelName,
      `expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}.defaultChannelName`,
    ),
    androidChannelImportance: getAndroidChannelImportance(
      runtimeConfig.androidChannelImportance,
      `expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}.androidChannelImportance`,
    ),
  };
}
