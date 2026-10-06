import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

import type { DeviceRegistrationState } from '../../src/runtime/tokens.ts';

const registrationStateCalls: Array<Record<string, unknown>> = [];
const syncCalls: Array<Record<string, unknown>> = [];
let registrationState: DeviceRegistrationState = {
  platform: 'ios',
  tokenType: null,
  token: null,
  fid: null,
  permissionStatus: 'denied',
  notificationsEnabled: false,
};

function createDeferred<Value>() {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

vi.doMock('../../src/runtime/transport.ts', () => ({
  getBubblesDeviceRegistrationState: async (
    options: Record<string, unknown>,
  ) => {
    registrationStateCalls.push(options);
    return registrationState;
  },
}));

vi.doMock('../../src/runtime/sync-device.ts', () => ({
  syncDeviceRegistrationState: async (options: Record<string, unknown>) => {
    syncCalls.push(options);
    return {
      action: options.deviceId ? 'updated' : 'created',
      deviceId: options.deviceId ?? 'created-device',
      pushToken: null,
      tokenType: null,
      permissionStatus: 'denied',
      notificationsEnabled: false,
      attributeSync: {
        status: 'succeeded',
        error: null,
      },
    };
  },
}));

const {
  maintainBubblesDevice,
  registerBubblesDevice,
  syncExistingBubblesDevice,
} = await import('../../src/runtime/register-device.ts');

beforeEach(() => {
  registrationStateCalls.length = 0;
  syncCalls.length = 0;
  registrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    fid: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  };
});

test('registerBubblesDevice creates with current denied permission state without prompting by default', async () => {
  const result = await registerBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    deviceId: null,
  });

  assert.deepEqual(registrationStateCalls, [
    {
      requestPermissions: false,
      permissionRequestOptions: undefined,
    },
  ]);
  assert.equal(syncCalls[0]?.registrationState, registrationState);
  assert.equal(syncCalls[0]?.deviceId, null);
  assert.equal(result.action, 'created');
});

test('registerBubblesDevice supports explicit permission prompting with default iOS options', async () => {
  await registerBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    deviceId: null,
    registrationOptions: {
      requestPermissions: true,
    },
  });

  assert.deepEqual(registrationStateCalls, [
    {
      requestPermissions: true,
      permissionRequestOptions: {
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      },
    },
  ]);
});

test('registerBubblesDevice starts permission registration before stored device loading finishes', async () => {
  const deferredDeviceId = createDeferred<string | null>();
  let deviceLoadStarted = false;

  const registration = registerBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    deviceId: null,
    loadDeviceId: async () => {
      deviceLoadStarted = true;
      return deferredDeviceId.promise;
    },
    registrationOptions: {
      requestPermissions: true,
    },
  });

  assert.equal(deviceLoadStarted, true);
  assert.equal(registrationStateCalls.length, 1);
  assert.equal(syncCalls.length, 0);

  deferredDeviceId.resolve('stored-device');
  await registration;

  assert.equal(syncCalls[0]?.deviceId, 'stored-device');
});

test('syncExistingBubblesDevice delegates updates to the non-prompting registration service', async () => {
  const result = await syncExistingBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    deviceId: 'existing-device',
  });

  assert.deepEqual(registrationStateCalls, [
    {
      requestPermissions: false,
      permissionRequestOptions: undefined,
    },
  ]);
  assert.equal(syncCalls[0]?.deviceId, 'existing-device');
  assert.equal(result.action, 'updated');
});

test('maintainBubblesDevice skips unchanged registration state without prompting or syncing', async () => {
  const result = await maintainBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    deviceId: 'existing-device',
    previousRegistrationState: registrationState,
  });

  assert.deepEqual(registrationStateCalls, [
    { requestPermissions: false },
  ]);
  assert.deepEqual(syncCalls, []);
  assert.equal(result.syncResult, null);
});

test('maintainBubblesDevice updates once when token or permission state changes', async () => {
  const previousRegistrationState = registrationState;
  registrationState = {
    platform: 'ios',
    tokenType: 'fcm',
    token: 'rotated-token',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  };

  const result = await maintainBubblesDevice({
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    aliasing: ['primary'],
    appVersion: '1.0.0',
    deviceId: 'existing-device',
    previousRegistrationState,
  });

  assert.deepEqual(registrationStateCalls, [
    { requestPermissions: false },
  ]);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.registrationState, registrationState);
  assert.equal(syncCalls[0]?.deviceId, 'existing-device');
  assert.equal(result.syncResult?.action, 'updated');
});

test('registerBubblesDevice rechecks state but skips backend enrollment for an unchanged session', async () => {
  const result = await registerBubblesDevice({
    appId: 'app-123', appKey: 'app-key-123', apiBaseUrl: 'https://api.example.com',
    userId: 'user-123', deviceId: 'existing-device',
    previousRegistrationState: { ...registrationState },
  });

  assert.equal(registrationStateCalls.length, 1);
  assert.equal(syncCalls.length, 0);
  assert.equal(result.action, 'unchanged');
  assert.equal(result.deviceId, 'existing-device');
});

test('registerBubblesDevice syncs permission and token changes despite an existing session', async () => {
  const previousRegistrationState = { ...registrationState };
  registrationState = {
    platform: 'ios', tokenType: 'fcm', token: 'new-token', fid: 'fid-123',
    permissionStatus: 'authorized', notificationsEnabled: true,
  };
  const options = {
    appId: 'app-123', appKey: 'app-key-123', apiBaseUrl: 'https://api.example.com',
    userId: 'user-123', deviceId: 'existing-device', previousRegistrationState,
  };
  await registerBubblesDevice(options);
  assert.equal(syncCalls.length, 1);
  assert.equal(syncCalls[0]?.deferPostRegistrationWork, true);

  options.previousRegistrationState = { ...registrationState };
  registrationState = { ...registrationState, token: 'rotated-token' };
  await registerBubblesDevice(options);
  assert.equal(syncCalls.length, 2);
});

test('registerBubblesDevice never skips enrollment without a backend device ID', async () => {
  await registerBubblesDevice({
    appId: 'app-123', appKey: 'app-key-123', apiBaseUrl: 'https://api.example.com',
    userId: 'user-123', deviceId: null, previousRegistrationState: registrationState,
  });
  assert.equal(syncCalls.length, 1);
});
