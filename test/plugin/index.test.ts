import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const BACKUP_EXCLUSIONS = 'backup-exclusions'
const RUNTIME_DEFAULTS = 'runtime-defaults'
const EXPO_NOTIFICATIONS = 'expo-notifications'
const FIREBASE_MESSAGING_MANIFEST = 'firebase-messaging-manifest'
const IOS_FID_REGISTRATION = 'ios-fid-registration'
const ANDROID_FID_REGISTRATION = 'android-fid-registration'
const RNFB_MAIN_THREAD_PATCH = 'rnfb-main-thread-patch'
const RNFIREBASE_DISABLE_SPM = 'rnfirebase-disable-spm'

const pluginCalls: string[] = []

function mockPlugin (modulePath: string, name: string): void {
  vi.doMock(modulePath, () => ({
    default (config: Record<string, unknown>) {
      pluginCalls.push(name)

      return config
    }
  }))
}

vi.doMock('../../plugin/src/config.ts', () => ({
  normalizePluginConfig (input?: {
    enableFirebaseInstallationPushRegistration?: boolean;
  }) {
    return {
      enableFirebaseInstallationPushRegistration:
        input?.enableFirebaseInstallationPushRegistration ?? false
    }
  }
}))

mockPlugin('../../plugin/src/with-installation-backup-exclusions.ts', BACKUP_EXCLUSIONS)
mockPlugin('../../plugin/src/with-runtime-defaults.ts', RUNTIME_DEFAULTS)
mockPlugin('../../plugin/src/with-expo-notifications.ts', EXPO_NOTIFICATIONS)
mockPlugin(
  '../../plugin/src/with-firebase-messaging-manifest.ts',
  FIREBASE_MESSAGING_MANIFEST
)
mockPlugin(
  '../../plugin/src/with-ios-firebase-messaging-registration.ts',
  IOS_FID_REGISTRATION
)
mockPlugin(
  '../../plugin/src/with-firebase-messaging-registration.ts',
  ANDROID_FID_REGISTRATION
)
mockPlugin(
  '../../plugin/src/with-rnfb-messaging-main-thread-patch.ts',
  RNFB_MAIN_THREAD_PATCH
)
mockPlugin(
  '../../plugin/src/with-rnfirebase-disable-spm.ts',
  RNFIREBASE_DISABLE_SPM
)

const { default: withBubblesNotificationsExpo } = await import(
  '../../plugin/src/index.ts'
)

beforeEach(() => {
  pluginCalls.length = 0
})

test('default plugin configuration applies cleanup-capable FID mods', () => {
  withBubblesNotificationsExpo({} as never, undefined)

  assert.deepEqual(pluginCalls, [
    BACKUP_EXCLUSIONS,
    RUNTIME_DEFAULTS,
    EXPO_NOTIFICATIONS,
    FIREBASE_MESSAGING_MANIFEST,
    RNFB_MAIN_THREAD_PATCH,
    RNFIREBASE_DISABLE_SPM,
    IOS_FID_REGISTRATION,
    ANDROID_FID_REGISTRATION
  ])
})

test('enabled plugin configuration applies messaging safety and FID native mods', () => {
  withBubblesNotificationsExpo({} as never, {
    enableFirebaseInstallationPushRegistration: true
  })

  assert.deepEqual(pluginCalls, [
    BACKUP_EXCLUSIONS,
    RUNTIME_DEFAULTS,
    EXPO_NOTIFICATIONS,
    FIREBASE_MESSAGING_MANIFEST,
    RNFB_MAIN_THREAD_PATCH,
    RNFIREBASE_DISABLE_SPM,
    IOS_FID_REGISTRATION,
    ANDROID_FID_REGISTRATION
  ])
})
