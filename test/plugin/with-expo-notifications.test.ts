import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const withStaticPluginCalls: Array<{
  config: Record<string, unknown>;
  options: Record<string, unknown>;
}> = [];

vi.doMock('expo/config-plugins', () => ({
  withStaticPlugin(
    config: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    withStaticPluginCalls.push({ config, options });

    return {
      ...config,
      appliedPlugin: options,
    };
  },
}));

const { default: withExpoNotifications } = await import(
  '../../plugin/src/with-expo-notifications.ts'
);

beforeEach(() => {
  withStaticPluginCalls.length = 0;
});

test('withExpoNotifications forwards the expected config to Expo built-in notifications plugin', () => {
  const config = withExpoNotifications(
    {
      name: 'demo-app',
      slug: 'demo-app',
    },
    {
      defaultChannelId: 'messages',
      defaultChannelName: 'Messages',
      androidChannelImportance: 'max',
      androidNotificationIcon: './icon.png',
      androidNotificationColor: '#FF00FF',
      enableBackgroundRemoteNotifications: false,
    },
  );

  assert.equal(withStaticPluginCalls.length, 1);
  assert.deepEqual(withStaticPluginCalls[0], {
    config: {
      name: 'demo-app',
      slug: 'demo-app',
    },
    options: {
      plugin: [
        'expo-notifications',
        {
          defaultChannel: 'messages',
          icon: './icon.png',
          color: '#FF00FF',
          enableBackgroundRemoteNotifications: false,
        },
      ],
    },
  });

  assert.deepEqual(config, {
    name: 'demo-app',
    slug: 'demo-app',
    appliedPlugin: {
      plugin: [
        'expo-notifications',
        {
          defaultChannel: 'messages',
          icon: './icon.png',
          color: '#FF00FF',
          enableBackgroundRemoteNotifications: false,
        },
      ],
    },
  });
});
