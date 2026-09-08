import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const expoConstants = {
  expoConfig: undefined as
    | {
        extra?: Record<string, unknown>;
      }
    | undefined,
};

vi.doMock('expo-constants', () => ({
  default: expoConstants,
}));

const {
  getBubblesNotificationsRuntimeConfig,
} = await import('../../src/config/runtime-config.ts');

beforeEach(() => {
  expoConstants.expoConfig = undefined;
});

test('reads and normalizes runtime config from expo.extra', () => {
  expoConstants.expoConfig = {
    extra: {
      bubblesNotificationsExpo: {
        defaultChannelId: ' default ',
        defaultChannelName: ' Default Channel ',
        androidChannelImportance: 'high',
      },
    },
  };

  assert.deepEqual(getBubblesNotificationsRuntimeConfig(), {
    defaultChannelId: 'default',
    defaultChannelName: 'Default Channel',
    androidChannelImportance: 'high',
  });
});

test('throws when Expo runtime config is unavailable', () => {
  assert.throws(
    () => getBubblesNotificationsRuntimeConfig(),
    /Expo runtime config is unavailable\./,
  );
});

test('throws when the package runtime config block is missing', () => {
  expoConstants.expoConfig = {
    extra: {},
  };

  assert.throws(
    () => getBubblesNotificationsRuntimeConfig(),
    /Missing "expo\.extra\.bubblesNotificationsExpo"\./,
  );
});

test('throws when android channel importance is invalid', () => {
  expoConstants.expoConfig = {
    extra: {
      bubblesNotificationsExpo: {
        defaultChannelId: 'default',
        defaultChannelName: 'Default',
        androidChannelImportance: 'urgent',
      },
    },
  };

  assert.throws(
    () => getBubblesNotificationsRuntimeConfig(),
    /"expo\.extra\.bubblesNotificationsExpo\.androidChannelImportance" must be one of: min, low, default, high, max\./,
  );
});
