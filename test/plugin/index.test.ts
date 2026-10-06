import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const pluginCalls: string[] = [];

function mockPlugin(modulePath: string, name: string): void {
  vi.doMock(modulePath, () => ({
    default(config: Record<string, unknown>) {
      pluginCalls.push(name);
      return config;
    },
  }));
}

vi.doMock('../../plugin/src/config.ts', () => ({
  normalizePluginConfig(input?: {
    enableFirebaseInstallationPushRegistration?: boolean;
  }) {
    return {
      enableFirebaseInstallationPushRegistration:
        input?.enableFirebaseInstallationPushRegistration ?? false,
    };
  },
}));

mockPlugin('../../plugin/src/with-runtime-defaults.ts', 'runtime-defaults');
mockPlugin('../../plugin/src/with-expo-notifications.ts', 'expo-notifications');
mockPlugin(
  '../../plugin/src/with-firebase-messaging-manifest.ts',
  'firebase-messaging-manifest',
);
mockPlugin(
  '../../plugin/src/with-ios-firebase-messaging-registration.ts',
  'ios-fid-registration',
);
mockPlugin(
  '../../plugin/src/with-firebase-messaging-registration.ts',
  'android-fid-registration',
);
mockPlugin(
  '../../plugin/src/with-rnfb-messaging-main-thread-patch.ts',
  'rnfb-main-thread-patch',
);
mockPlugin(
  '../../plugin/src/with-rnfirebase-disable-spm.ts',
  'rnfirebase-disable-spm',
);

const { default: withBubblesNotificationsExpo } = await import(
  '../../plugin/src/index.ts'
);

beforeEach(() => {
  pluginCalls.length = 0;
});

test('default plugin configuration applies messaging safety mods without FID registration', () => {
  withBubblesNotificationsExpo({} as never, undefined);

  assert.deepEqual(pluginCalls, [
    'runtime-defaults',
    'expo-notifications',
    'firebase-messaging-manifest',
    'rnfb-main-thread-patch',
    'rnfirebase-disable-spm',
  ]);
});

test('enabled plugin configuration applies messaging safety and FID native mods', () => {
  withBubblesNotificationsExpo({} as never, {
    enableFirebaseInstallationPushRegistration: true,
  });

  assert.deepEqual(pluginCalls, [
    'runtime-defaults',
    'expo-notifications',
    'firebase-messaging-manifest',
    'rnfb-main-thread-patch',
    'rnfirebase-disable-spm',
    'ios-fid-registration',
    'android-fid-registration',
  ]);
});
