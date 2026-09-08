import assert from 'node:assert/strict';
import { test } from 'vitest';

import { normalizePluginConfig } from '../../plugin/src/config.ts';
import withRuntimeDefaults from '../../plugin/src/with-runtime-defaults.ts';

test('normalizePluginConfig applies documented defaults', () => {
  assert.deepEqual(normalizePluginConfig(), {
    defaultChannelId: 'default',
    defaultChannelName: 'Default',
    androidChannelImportance: 'max',
    androidNotificationIcon: undefined,
    androidNotificationColor: undefined,
    enableBackgroundRemoteNotifications: true,
  });
});

test('normalizePluginConfig validates notification color and option types', () => {
  assert.throws(
    () =>
      normalizePluginConfig({
        androidNotificationColor: 'blue',
      }),
    /"androidNotificationColor" must be a hex color in #RRGGBB or #AARRGGBB format\./,
  );

  assert.throws(
    () =>
      normalizePluginConfig({
        enableBackgroundRemoteNotifications: 'yes' as never,
      }),
    /"enableBackgroundRemoteNotifications" must be a boolean\./,
  );

  assert.throws(
    () =>
      normalizePluginConfig({
        androidChannelImportance: 'urgent' as never,
      }),
    /"androidChannelImportance" must be one of: min, low, default, high, max\./,
  );
});

test('withRuntimeDefaults merges package defaults without dropping unrelated extra fields', () => {
  const config = withRuntimeDefaults(
    {
      name: 'demo-app',
      slug: 'demo-app',
      extra: {
        existingKey: 'keep-me',
        bubblesNotificationsExpo: {
          customField: 'preserve-me',
          defaultChannelId: 'stale',
        },
      },
    },
    {
      defaultChannelId: 'default',
      defaultChannelName: 'Default',
      androidChannelImportance: 'high',
      enableBackgroundRemoteNotifications: true,
    },
  );

  assert.deepEqual(config.extra, {
    existingKey: 'keep-me',
    bubblesNotificationsExpo: {
      customField: 'preserve-me',
      defaultChannelId: 'default',
      defaultChannelName: 'Default',
      androidChannelImportance: 'high',
    },
  });
});
