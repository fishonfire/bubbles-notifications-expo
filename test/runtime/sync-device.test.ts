import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

import type { DeviceRegistrationState } from '../../src/runtime/tokens.ts';

type SyncResult = {
  action: 'created' | 'updated';
  deviceId: string | null;
  response: { id: string };
};

const syncCalls: Array<Record<string, unknown>> = [];
const attributeCalls: Array<Record<string, unknown>> = [];
const storedApiBaseUrls: string[] = [];
const storedAppKeys: string[] = [];
const storedDeviceIds: Array<string | null> = [];
const tokenCalls: Array<Record<string, unknown>> = [];
const syncState: {
  implementation: () => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'created',
    deviceId: 'created-device-id',
    response: { id: 'created-device-id' },
  }),
};
const attributeCollectionState: {
  implementation: () => Promise<Record<string, unknown>>;
} = {
  implementation: async () => ({
    device: {
      manufacturer: 'Apple',
      deviceType: 'phone',
    },
    app: {
      applicationId: 'com.example.app',
    },
  }),
};
const attributeState: {
  implementation: (options: Record<string, unknown>) => Promise<void>;
} = {
  implementation: async () => undefined,
};
const tokenState: {
  registrationState: DeviceRegistrationState;
} = {
  registrationState: {
    platform: 'android',
    tokenType: 'fcm',
    token: 'token-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  },
};
const installationCalls: string[] = [];
const installationState: {
  installationId: string;
} = {
  installationId: 'fid-123',
};

vi.doMock('../../src/api/device-client.ts', () => ({
  syncBubblesDevice: async (options: Record<string, unknown>) => {
    syncCalls.push(options);
    return syncState.implementation();
  },
  updateBubblesDeviceAttributes: async (options: Record<string, unknown>) => {
    attributeCalls.push(options);
    await attributeState.implementation(options);
  },
}));

vi.doMock('../../src/runtime/device-attributes.ts', () => ({
  collectBubblesDeviceAttributes: async () =>
    attributeCollectionState.implementation(),
}));

vi.doMock('../../src/storage/device-state.ts', () => ({
  storeApiBaseUrl: (value: string) => {
    storedApiBaseUrls.push(value);
    return {
      deviceId: null,
      apiBaseUrl: value,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null,
    };
  },
  storeAppKey: (value: string) => {
    storedAppKeys.push(value);
    return {
      deviceId: null,
      apiBaseUrl:
        storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: value,
    };
  },
  storeDeviceId: (value: string | null) => {
    storedDeviceIds.push(value);
    return {
      deviceId: value,
      apiBaseUrl:
        storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null,
    };
  },
}));

vi.doMock('../../src/runtime/transport.ts', () => ({
  getBubblesDeviceRegistrationState: async (
    options: Record<string, unknown>,
  ) => {
    tokenCalls.push(options);
    return tokenState.registrationState;
  },
  getBubblesInstallationId: async (platform: string) => {
    installationCalls.push(platform);
    return installationState.installationId;
  },
}));

const {
  BubblesNotificationsSyncError,
  syncDeviceRegistrationState,
  syncExistingBubblesDevice,
} = await import('../../src/runtime/sync-device.ts');

beforeEach(() => {
  syncCalls.length = 0;
  attributeCalls.length = 0;
  storedApiBaseUrls.length = 0;
  storedAppKeys.length = 0;
  storedDeviceIds.length = 0;
  tokenCalls.length = 0;
  installationCalls.length = 0;
  syncState.implementation = async () => ({
    action: 'created',
    deviceId: 'created-device-id',
    response: { id: 'created-device-id' },
  });
  attributeCollectionState.implementation = async () => ({
    device: {
      manufacturer: 'Apple',
      deviceType: 'phone',
    },
    app: {
      applicationId: 'com.example.app',
    },
  });
  attributeState.implementation = async () => undefined;
  installationState.installationId = 'fid-123';
  tokenState.registrationState = {
    platform: 'android',
    tokenType: 'fcm',
    token: 'token-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  };
});

test('syncDeviceRegistrationState stores base URL, resolves installation id, and returns snapshot data', async () => {
  const result = await syncDeviceRegistrationState({
    appId: 'app-123',
    appKey: ' app-key-1 ',
    apiBaseUrl: ' https://api.example.com ',
    userId: 'user-123',
    aliasing: ['alpha'],
    appVersion: '1.0.0',
    deviceId: null,
    registrationState: tokenState.registrationState,
  });

  assert.deepEqual(installationCalls, ['android']);
  assert.deepEqual(storedApiBaseUrls, ['https://api.example.com']);
  assert.deepEqual(storedAppKeys, ['app-key-1']);
  assert.deepEqual(storedDeviceIds, ['created-device-id']);
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-1',
      deviceId: 'created-device-id',
      attributes: {
        device: {
          manufacturer: 'Apple',
          deviceType: 'phone',
        },
        app: {
          applicationId: 'com.example.app',
        },
      },
    },
  ]);
  assert.deepEqual(syncCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appId: 'app-123',
      appKey: 'app-key-1',
      userId: 'user-123',
      aliasing: ['alpha'],
      appVersion: '1.0.0',
      deviceId: null,
      platform: 'android',
      pushToken: 'token-123',
      fid: 'fid-123',
      notificationsEnabled: true,
    },
  ]);
  assert.deepEqual(result, {
    action: 'created',
    deviceId: 'created-device-id',
    pushToken: 'token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
});

test('syncDeviceRegistrationState skips installation-id lookup when notifications are disabled', async () => {
  tokenState.registrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  };
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: 'existing-device-id',
    response: { id: 'existing-device-id' },
  });

  const result = await syncDeviceRegistrationState({
    appId: 'app-456',
    appKey: 'app-key-2',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-456',
    deviceId: 'existing-device-id',
    registrationState: tokenState.registrationState,
  });

  assert.deepEqual(installationCalls, []);
  assert.equal(syncCalls[0]?.fid, null);
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-2',
      deviceId: 'existing-device-id',
      attributes: {
        device: {
          manufacturer: 'Apple',
          deviceType: 'phone',
        },
        app: {
          applicationId: 'com.example.app',
        },
      },
    },
  ]);
  assert.deepEqual(result, {
    action: 'updated',
    deviceId: 'existing-device-id',
    pushToken: null,
    tokenType: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  });
});

test('syncDeviceRegistrationState wraps sync failures with a snapshot-rich error', async () => {
  syncState.implementation = async () => {
    throw new Error('sync failed');
  };

  await assert.rejects(
    () =>
      syncDeviceRegistrationState({
        appId: 'app-789',
        appKey: 'app-key-3',
        apiBaseUrl: 'https://api.example.com',
        userId: 'user-789',
        deviceId: 'device-789',
        registrationState: tokenState.registrationState,
      }),
    (error: unknown) => {
      assert.ok(error instanceof BubblesNotificationsSyncError);
      assert.equal(error.message, 'sync failed');
      assert.deepEqual(error.snapshot, {
        deviceId: 'device-789',
        pushToken: 'token-123',
        tokenType: 'fcm',
        permissionStatus: 'granted',
        notificationsEnabled: true,
      });
      return true;
    },
  );

  assert.deepEqual(storedApiBaseUrls, ['https://api.example.com']);
  assert.deepEqual(storedDeviceIds, []);
});

test('syncDeviceRegistrationState ignores attribute collection failures after registration succeeds', async () => {
  attributeCollectionState.implementation = async () => {
    throw new Error('attribute collection failed');
  };

  const result = await syncDeviceRegistrationState({
    appId: 'app-attributes',
    appKey: 'app-key-attributes',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-attributes',
    deviceId: null,
    registrationState: tokenState.registrationState,
  });

  assert.deepEqual(storedDeviceIds, ['created-device-id']);
  assert.deepEqual(attributeCalls, []);
  assert.deepEqual(result, {
    action: 'created',
    deviceId: 'created-device-id',
    pushToken: 'token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
});

test('syncDeviceRegistrationState ignores attribute update failures after registration succeeds', async () => {
  attributeState.implementation = async () => {
    throw new Error('attribute update failed');
  };

  const result = await syncDeviceRegistrationState({
    appId: 'app-attributes',
    appKey: 'app-key-attributes',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-attributes',
    deviceId: null,
    registrationState: tokenState.registrationState,
  });

  assert.deepEqual(storedDeviceIds, ['created-device-id']);
  assert.equal(attributeCalls.length, 1);
  assert.deepEqual(result, {
    action: 'created',
    deviceId: 'created-device-id',
    pushToken: 'token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
});

test('syncExistingBubblesDevice uses non-prompting registration state lookup', async () => {
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: 'device-999',
    response: { id: 'device-999' },
  });

  const result = await syncExistingBubblesDevice({
    appId: 'app-999',
    appKey: 'app-key-4',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-999',
    deviceId: 'device-999',
  });

  assert.deepEqual(tokenCalls, [{ requestPermissions: false }]);
  assert.equal(syncCalls[0]?.deviceId, 'device-999');
  assert.equal(result.action, 'updated');
});
