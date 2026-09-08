import {
  AndroidConfig,
  ConfigPlugin,
  withAndroidManifest,
} from 'expo/config-plugins';

import type {
  NormalizedBubblesNotificationsExpoPluginConfig,
} from './config';

const FCM_DEFAULT_CHANNEL =
  'com.google.firebase.messaging.default_notification_channel_id';

const FCM_DEFAULT_COLOR =
  'com.google.firebase.messaging.default_notification_color';

type ToolsReplaceValue = 'android:value' | 'android:resource';

const withFirebaseMessagingManifest: ConfigPlugin<
  NormalizedBubblesNotificationsExpoPluginConfig
> = (config, options) => {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults;

    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    AndroidConfig.Manifest.ensureToolsAvailable(manifest);

    // Always define the default channel ourselves.
    //
    // This makes the compatibility fix independent of whether
    // expo-notifications' manifest mod runs before or after this one.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      FCM_DEFAULT_CHANNEL,
      options.defaultChannelId,
      'value',
    );

    const channel = application['meta-data']?.find(
      item => item.$['android:name'] === FCM_DEFAULT_CHANNEL,
    );

    if (channel) {
      setToolsReplace(channel.$, 'android:value');
    }

    // Expo only creates the FCM color metadata when a notification
    // color has actually been configured.
    if (options.androidNotificationColor) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        application,
        FCM_DEFAULT_COLOR,
        '@color/notification_icon_color',
        'resource',
      );

      const color = application['meta-data']?.find(
        item => item.$['android:name'] === FCM_DEFAULT_COLOR,
      );

      if (color) {
        setToolsReplace(color.$, 'android:resource');
      }
    }

    return config;
  });
};

function setToolsReplace(
  attributes: {
    'android:name': string;
  },
  value: ToolsReplaceValue,
): void {
  (
    attributes as typeof attributes & {
      'tools:replace'?: ToolsReplaceValue;
    }
  )['tools:replace'] = value;
}

export default withFirebaseMessagingManifest;
