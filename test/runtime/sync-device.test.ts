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
const deliveryStatusFlushCalls: Array<Record<string, unknown>> = [];
let deliveryStatusFlushError: Error | null = null;
let deferredFlush: Promise<void> | null = null;
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
    token: 'fcm-token-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  },
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

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  flushStoredBubblesDeliveryStatuses: async (
    storedDeviceState: Record<string, unknown>,
  ) => {
    deliveryStatusFlushCalls.push(storedDeviceState);
    await deferredFlush;

    if (deliveryStatusFlushError) {
      throw deliveryStatusFlushError;
    }
  },
}));

vi.doMock('../../src/storage/device-state.ts', () => ({
  patchStoredDeviceStateAsync: async (
    value: {
      apiBaseUrl?: string | null;
      appKey?: string | null;
    },
  ) => {
    if ('apiBaseUrl' in value) {
      storedApiBaseUrls.push(value.apiBaseUrl as string);
    }

    if ('appKey' in value) {
      storedAppKeys.push(value.appKey as string);
    }

    return {
      deviceId: null,
      apiBaseUrl: storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null,
    };
  },
  storeDeviceIdAsync: async (value: string | null) => {
    storedDeviceIds.push(value);
    return {
      deviceId: value,
      apiBaseUrl:
        storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null,
    };
  },
}));

const {
  BubblesNotificationsSyncError,
  syncDeviceRegistrationState,
} = await import('../../src/runtime/sync-device.ts');

beforeEach(() => {
  syncCalls.length = 0;
  attributeCalls.length = 0;
  storedApiBaseUrls.length = 0;
  storedAppKeys.length = 0;
  storedDeviceIds.length = 0;
  deliveryStatusFlushCalls.length = 0;
  deliveryStatusFlushError = null;
  deferredFlush = null;
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
  tokenState.registrationState = {
    platform: 'android',
    tokenType: 'fcm',
    token: 'fcm-token-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  };
});

test('syncDeviceRegistrationState stores base URL, sends FCM token with FID, and returns snapshot data', async () => {
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

  assert.deepEqual(storedApiBaseUrls, ['https://api.example.com']);
  assert.deepEqual(storedAppKeys, ['app-key-1']);
  assert.deepEqual(storedDeviceIds, ['created-device-id']);
  assert.deepEqual(deliveryStatusFlushCalls, [
    {
      deviceId: 'created-device-id',
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-1',
    },
  ]);
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
      pushToken: 'fcm-token-123',
      fid: 'fid-123',
      notificationsEnabled: true,
    },
  ]);
  assert.deepEqual(result, {
    action: 'created',
    deviceId: 'created-device-id',
    pushToken: 'fcm-token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'succeeded',
      error: null,
    },
  });
});

test('syncDeviceRegistrationState sends FID as push token when FID registration is enabled', async () => {
  tokenState.registrationState = {
    platform: 'android',
    tokenType: 'fid',
    token: 'fid-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  };

  const result = await syncDeviceRegistrationState({
    appId: 'app-fid',
    appKey: 'app-key-fid',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-fid',
    deviceId: null,
    registrationState: tokenState.registrationState,
  });

  assert.equal(syncCalls[0]?.pushToken, 'fid-123');
  assert.equal(syncCalls[0]?.fid, 'fid-123');
  assert.equal(result.pushToken, 'fid-123');
  assert.equal(result.tokenType, 'fid');
});

test('syncDeviceRegistrationState skips installation-id lookup when notifications are disabled', async () => {
  tokenState.registrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    fid: null,
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
    attributeSync: {
      status: 'succeeded',
      error: null,
    },
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
        pushToken: 'fcm-token-123',
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

test('syncDeviceRegistrationState reports attribute collection failures after registration succeeds', async () => {
  const attributeError = new Error('attribute collection failed');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  attributeCollectionState.implementation = async () => {
    throw attributeError;
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
    pushToken: 'fcm-token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'failed',
      error: attributeError,
    },
  });
  assert.equal(consoleError.mock.calls.length, 1);

  consoleError.mockRestore();
});

test('syncDeviceRegistrationState reports attribute update failures after registration succeeds', async () => {
  const attributeError = new Error('attribute update failed');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  attributeState.implementation = async () => {
    throw attributeError;
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
    pushToken: 'fcm-token-123',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'failed',
      error: attributeError,
    },
  });
  assert.equal(consoleError.mock.calls.length, 1);

  consoleError.mockRestore();
});

test('syncDeviceRegistrationState keeps registration successful when delivery-status flush fails', async () => {
  deliveryStatusFlushError = new Error('delivery status unavailable');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  const result = await syncDeviceRegistrationState({
    appId: 'app-delivery-status',
    appKey: 'app-key-delivery-status',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-delivery-status',
    deviceId: null,
    registrationState: tokenState.registrationState,
  });

  assert.equal(result.deviceId, 'created-device-id');
  assert.equal(deliveryStatusFlushCalls.length, 1);
  assert.equal(attributeCalls.length, 1);
  assert.equal(consoleError.mock.calls.length, 1);

  consoleError.mockRestore();
});

test('deferred post-registration requests do not hold up enrollment or each other', async () => {
  let finishAttributes!: () => void;
  let finishFlush!: () => void;
  const attributeRequest = new Promise<void>(resolve => { finishAttributes = resolve; });
  const flushRequest = new Promise<void>(resolve => { finishFlush = resolve; });
  attributeState.implementation = async () => attributeRequest;
  deferredFlush = flushRequest;

  const result = await syncDeviceRegistrationState({
    appId: 'app-123', appKey: 'app-key-123', apiBaseUrl: 'https://api.example.com',
    userId: 'user-123', deviceId: null, registrationState: tokenState.registrationState,
    deferPostRegistrationWork: true,
  });

  assert.equal(result.deviceId, 'created-device-id');
  assert.deepEqual(storedDeviceIds, ['created-device-id']);
  assert.equal(result.attributeSync.status, 'pending');
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  assert.equal(deliveryStatusFlushCalls.length, 1);
  assert.equal(attributeCalls.length, 1);

  finishAttributes();
  finishFlush();
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
});
