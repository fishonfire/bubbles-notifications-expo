import assert from 'node:assert/strict'
import { compileModsAsync } from 'expo/config-plugins'
import { test } from 'vitest'

const ANDROID_NAME_ATTRIBUTE = 'android:name'
const FIREBASE_REGISTRAR_CLASS = '.BubblesFirebaseMessagingRegistrar'
const FIREBASE_NOTIFICATION_COLOR_KEY = 'com.google.firebase.messaging.default_notification_color'
const EXPO_NOTIFICATION_COLOR_KEY = 'expo.modules.notifications.default_notification_color'

const { default: withBubblesNotificationsExpo } = await import(
  '../../plugin/src/index.ts'
)

async function introspectPlugin (
  options?: Record<string, unknown>
) {
  const projectRoot = process.cwd()
  let config = withBubblesNotificationsExpo(
    {
      name: 'demo-app',
      slug: 'demo-app',
      ios: {
        bundleIdentifier: 'com.demo.app'
      },
      android: {
        package: 'com.demo.app'
      },
      _internal: {
        projectRoot
      }
    } as never,
    options as never
  )

  config = await compileModsAsync(config as never, {
    projectRoot,
    introspect: true,
    platforms: ['android', 'ios']
  })

  return config as never as {
    ios: {
      infoPlist: Record<string, unknown>;
    };
    _internal: {
      modResults: {
        android: {
          manifest: {
            manifest: {
              application: {
                'meta-data'?: {
                  $: Record<string, string>;
                }[];
                provider?: {
                  $: Record<string, string>;
                }[];
                service?: {
                  $: Record<string, string>;
                  'intent-filter'?: {
                    action?: {
                      $: Record<string, string>;
                    }[];
                  }[];
                }[];
              }[];
            };
          };
        };
      };
    };
  }
}

function getAndroidManifestMetaData (
  config: Awaited<ReturnType<typeof introspectPlugin>>
) {
  return (
    config._internal.modResults.android.manifest.manifest.application[0]?.[
      'meta-data'
    ] ?? []
  )
}

function findMetaDataItem (
  metaData: ReturnType<typeof getAndroidManifestMetaData>,
  name: string
) {
  return metaData.find((item) => item.$[ANDROID_NAME_ATTRIBUTE] === name)
}

function getAndroidManifestApplication (
  config: Awaited<ReturnType<typeof introspectPlugin>>
) {
  return config._internal.modResults.android.manifest.manifest.application[0]
}

test('plugin introspection preserves the FCM default-channel metadata and replaces android:value', async () => {
  const config = await introspectPlugin({
    defaultChannelId: 'messages',
    defaultChannelName: 'Messages',
    enableBackgroundRemoteNotifications: true
  })
  const metaData = getAndroidManifestMetaData(config)

  assert.deepEqual(
    findMetaDataItem(
      metaData,
      'com.google.firebase.messaging.default_notification_channel_id'
    ),
    {
      $: {
        [ANDROID_NAME_ATTRIBUTE]:
          'com.google.firebase.messaging.default_notification_channel_id',
        'android:value': 'messages',
        'tools:replace': 'android:value'
      }
    }
  )
})

test('plugin introspection leaves Firebase installation id registration disabled by default', async () => {
  const config = await introspectPlugin()
  const application = getAndroidManifestApplication(config)
  const metaData = getAndroidManifestMetaData(config)

  assert.equal(
    config.ios.infoPlist.FirebaseMessagingInstallationIdEnabled,
    undefined
  )
  assert.equal(
    findMetaDataItem(
      metaData,
      'firebase_messaging_installation_id_enabled'
    ),
    undefined
  )
  assert.equal(
    application.provider?.some(
      item =>
        item.$[ANDROID_NAME_ATTRIBUTE] === FIREBASE_REGISTRAR_CLASS
    ) ?? false,
    false
  )
})

test('plugin introspection configures Firebase installation id registration when enabled', async () => {
  const config = await introspectPlugin({
    enableFirebaseInstallationPushRegistration: true
  })
  const application = getAndroidManifestApplication(config)
  const metaData = getAndroidManifestMetaData(config)

  assert.equal(
    config.ios.infoPlist.FirebaseMessagingInstallationIdEnabled,
    true
  )
  assert.deepEqual(
    findMetaDataItem(
      metaData,
      'firebase_messaging_installation_id_enabled'
    ),
    {
      $: {
        [ANDROID_NAME_ATTRIBUTE]: 'firebase_messaging_installation_id_enabled',
        'android:value': 'true'
      }
    }
  )
  assert.deepEqual(
    application.provider?.find(
      item =>
        item.$[ANDROID_NAME_ATTRIBUTE] === FIREBASE_REGISTRAR_CLASS
    ),
    {
      $: {
        [ANDROID_NAME_ATTRIBUTE]: FIREBASE_REGISTRAR_CLASS,
        'android:authorities':
          'com.demo.app.bubblesnotifications.fcmregistrar',
        'android:exported': 'false',
        'android:initOrder': '100'
      }
    }
  )
  assert.equal(
    application.service?.some(
      item =>
        item.$[ANDROID_NAME_ATTRIBUTE] ===
        'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService'
    ),
    false
  )
  assert.equal(
    application.service?.some(
      item => item.$[ANDROID_NAME_ATTRIBUTE] === '.BubblesFirebaseMessagingService'
    ),
    false
  )
})

test('plugin introspection only emits notification-color metadata when a color is configured', async () => {
  const withColor = await introspectPlugin({
    androidNotificationColor: '#FF00FF'
  })
  const withoutColor = await introspectPlugin()
  const withColorMetaData = getAndroidManifestMetaData(withColor)
  const withoutColorMetaData = getAndroidManifestMetaData(withoutColor)

  assert.deepEqual(
    findMetaDataItem(
      withColorMetaData,
      FIREBASE_NOTIFICATION_COLOR_KEY
    ),
    {
      $: {
        [ANDROID_NAME_ATTRIBUTE]:
          FIREBASE_NOTIFICATION_COLOR_KEY,
        'android:resource': '@color/notification_icon_color',
        'tools:replace': 'android:resource'
      }
    }
  )
  assert.deepEqual(
    findMetaDataItem(
      withColorMetaData,
      EXPO_NOTIFICATION_COLOR_KEY
    ),
    {
      $: {
        [ANDROID_NAME_ATTRIBUTE]: EXPO_NOTIFICATION_COLOR_KEY,
        'android:resource': '@color/notification_icon_color'
      }
    }
  )
  assert.equal(
    findMetaDataItem(
      withoutColorMetaData,
      FIREBASE_NOTIFICATION_COLOR_KEY
    ),
    undefined
  )
  assert.equal(
    findMetaDataItem(
      withoutColorMetaData,
      EXPO_NOTIFICATION_COLOR_KEY
    ),
    undefined
  )
})

test('plugin introspection only adds the iOS remote-notification background mode when enabled', async () => {
  const enabled = await introspectPlugin({
    enableBackgroundRemoteNotifications: true
  })
  const disabled = await introspectPlugin({
    enableBackgroundRemoteNotifications: false
  })

  assert.deepEqual(enabled.ios.infoPlist.UIBackgroundModes, [
    'remote-notification'
  ])
  assert.equal(disabled.ios.infoPlist.UIBackgroundModes, undefined)
})
