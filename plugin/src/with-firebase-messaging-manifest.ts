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

const FCM_INSTALLATION_ID_ENABLED =
  'firebase_messaging_installation_id_enabled';

const RN_FIREBASE_MESSAGING_SERVICE =
  'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService';

const BUBBLES_FIREBASE_MESSAGING_SERVICE =
  '.BubblesFirebaseMessagingService';

const BUBBLES_FIREBASE_MESSAGING_REGISTRAR =
  '.BubblesFirebaseMessagingRegistrar';

type ToolsReplaceValue = 'android:value' | 'android:resource';

type ManifestProvider = {
  $: {
    'android:name': string;
    'android:authorities': string;
    'android:exported': 'true' | 'false';
    'android:initOrder'?: string;
  };
};

type ManifestApplicationWithProvider =
  AndroidConfig.Manifest.ManifestApplication & {
    provider?: ManifestProvider[];
  };

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

    if (options.enableFirebaseInstallationPushRegistration) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        application,
        FCM_INSTALLATION_ID_ENABLED,
        'true',
        'value',
      );

      addBubblesFirebaseMessagingRegistrationEntries(
        application,
        getAndroidPackageName(config),
      );
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

function getAndroidPackageName(config: {
  android?: {
    package?: string;
  };
}): string {
  const packageName = config.android?.package?.trim();

  if (!packageName) {
    throw new Error(
      '[@fishonfire/bubbles-expo] "expo.android.package" is required to configure Android Firebase Messaging registration.',
    );
  }

  return packageName;
}

function addBubblesFirebaseMessagingRegistrationEntries(
  application: ManifestApplicationWithProvider,
  packageName: string,
): void {
  application.service = application.service ?? [];
  application.provider = application.provider ?? [];

  removeManifestService(application, RN_FIREBASE_MESSAGING_SERVICE);
  removeManifestService(application, BUBBLES_FIREBASE_MESSAGING_SERVICE);

  upsertManifestProvider(application, {
    $: {
      'android:name': BUBBLES_FIREBASE_MESSAGING_REGISTRAR,
      'android:authorities': `${packageName}.bubblesnotifications.fcmregistrar`,
      'android:exported': 'false',
      'android:initOrder': '100',
    },
  });
}

function removeManifestService(
  application: AndroidConfig.Manifest.ManifestApplication,
  serviceName: string,
): void {
  application.service = (application.service ?? []).filter(
    item => item.$['android:name'] !== serviceName,
  );
}

function upsertManifestProvider(
  application: ManifestApplicationWithProvider,
  provider: ManifestProvider,
): void {
  application.provider = [
    ...(application.provider ?? []).filter(
      item => item.$['android:name'] !== provider.$['android:name'],
    ),
    provider,
  ];
}

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
