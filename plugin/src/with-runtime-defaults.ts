import type { ExpoConfig } from '@expo/config-types';

import type { NormalizedBubblesNotificationsExpoPluginConfig } from './config';
import { BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY } from './shared-config';

type RuntimeDefaults = Pick<
  NormalizedBubblesNotificationsExpoPluginConfig,
  'defaultChannelId' | 'defaultChannelName' | 'androidChannelImportance'
>;

function fail(message: string): never {
  throw new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export default function withRuntimeDefaults(
  config: ExpoConfig,
  options: NormalizedBubblesNotificationsExpoPluginConfig,
): ExpoConfig {
  const existingExtra = config.extra ?? {};
  const existingRuntimeDefaults =
    existingExtra[BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY];

  if (
    existingRuntimeDefaults !== undefined &&
    !isPlainObject(existingRuntimeDefaults)
  ) {
    fail(
      `"expo.extra.${BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY}" must be an object when it is defined.`,
    );
  }

  const runtimeDefaults: RuntimeDefaults = {
    defaultChannelId: options.defaultChannelId,
    defaultChannelName: options.defaultChannelName,
    androidChannelImportance: options.androidChannelImportance,
  };

  return {
    ...config,
    extra: {
      ...existingExtra,
      [BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY]: {
        ...(existingRuntimeDefaults ?? {}),
        ...runtimeDefaults,
      },
    },
  };
}
