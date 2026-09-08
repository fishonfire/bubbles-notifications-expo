import type { ExpoConfig } from '@expo/config-types';
import { withStaticPlugin } from 'expo/config-plugins';

import type { NormalizedBubblesNotificationsExpoPluginConfig } from './config';

type ExpoNotificationsPluginProps = {
  defaultChannel: string;
  icon?: string;
  color?: string;
  enableBackgroundRemoteNotifications: boolean;
};

export default function withExpoNotifications(
  config: ExpoConfig,
  options: NormalizedBubblesNotificationsExpoPluginConfig,
): ExpoConfig {
  const pluginOptions: ExpoNotificationsPluginProps = {
    defaultChannel: options.defaultChannelId,
    enableBackgroundRemoteNotifications:
      options.enableBackgroundRemoteNotifications,
  };

  if (options.androidNotificationIcon) {
    pluginOptions.icon = options.androidNotificationIcon;
  }

  if (options.androidNotificationColor) {
    pluginOptions.color = options.androidNotificationColor;
  }

  return withStaticPlugin(config, {
    plugin: ['expo-notifications', pluginOptions],
  });
}
