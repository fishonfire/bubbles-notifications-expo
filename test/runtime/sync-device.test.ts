import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

import type { DeviceRegistrationState } from '../../src/runtime/tokens.ts'

const API_BASE_URL = 'https://api.example.com'

const CREATED_DEVICE_ID = 'created-device-id'
const APP_BUNDLE_ID = 'com.example.app'
const FCM_TOKEN = 'fcm-token-123'
const PADDED_API_BASE_URL = ` ${API_BASE_URL} `
const EXISTING_DEVICE_ID = 'existing-device-id'

type SyncResult = {
  action: 'created' | 'updated';
  deviceId: string | null;
  response: { id: string };
}

const syncCalls: Record<string, unknown>[] = []
const attributeCalls: Record<string, unknown>[] = []
const storedApiBaseUrls: string[] = []
const storedAppKeys: string[] = []
const storedDeviceIds: (string | null)[] = []
const deliveryStatusFlushCalls: Record<string, unknown>[] = []
let deliveryStatusFlushError: Error | null = null
let deferredFlush: Promise<void> | null = null
const syncState: {
  implementation: () => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'created',
    deviceId: CREATED_DEVICE_ID,
    response: { id: CREATED_DEVICE_ID }
  })
}
const attributeCollectionState: {
  implementation: () => Promise<Record<string, unknown>>;
} = {
  implementation: async () => ({
    device: {
      manufacturer: 'Apple',
      deviceType: 'phone'
    },
    app: {
      applicationId: APP_BUNDLE_ID
    }
  })
}
const attributeState: {
  implementation: (options: Record<string, unknown>) => Promise<void>;
} = {
  implementation: async () => undefined
}
const tokenState: {
  registrationState: DeviceRegistrationState;
} = {
  registrationState: {
    platform: 'android',
    tokenType: 'fcm',
    token: FCM_TOKEN,
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true
  }
}

vi.doMock('../../src/runtime/migration.ts', () => ({
  resolveRegistrationIdentity: async (options: { deviceId: string | null; apiBaseUrl: string; appKey: string }) => {
    storedApiBaseUrls.push(options.apiBaseUrl)
    storedAppKeys.push(options.appKey)

    return { deviceId: options.deviceId }
  }
}))

vi.doMock('../../src/api/device-client.ts', () => ({
  syncBubblesDevice: async (options: Record<string, unknown>) => {
    syncCalls.push(options)

    return syncState.implementation()
  },
  updateBubblesDeviceAttributes: async (options: Record<string, unknown>) => {
    attributeCalls.push(options)
    await attributeState.implementation(options)
  }
}))

vi.doMock('../../src/runtime/device-attributes.ts', () => ({
  collectBubblesDeviceAttributes: async () =>
    attributeCollectionState.implementation()
}))

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  flushStoredBubblesDeliveryStatuses: async (
    storedDeviceState: Record<string, unknown>
  ) => {
    deliveryStatusFlushCalls.push(storedDeviceState)
    await deferredFlush

    if (deliveryStatusFlushError) {
      throw deliveryStatusFlushError
    }
  }
}))

vi.doMock('../../src/storage/device-state.ts', () => ({
  patchStoredDeviceStateAsync: async (
    value: {
      apiBaseUrl?: string | null;
      appKey?: string | null;
    }
  ) => {
    if ('apiBaseUrl' in value) {
      storedApiBaseUrls.push(value.apiBaseUrl as string)
    }

    if ('appKey' in value) {
      storedAppKeys.push(value.appKey as string)
    }

    return {
      deviceId: null,
      apiBaseUrl: storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null
    }
  },
  acknowledgeRegistrationScope: async (_scope: string, value: string | null) => {
    storedDeviceIds.push(value)

    return {
      deviceId: value,
      apiBaseUrl:
        storedApiBaseUrls[storedApiBaseUrls.length - 1] ?? null,
      appKey: storedAppKeys[storedAppKeys.length - 1] ?? null
    }
  }
}))

const {
  BubblesNotificationsSyncError,
  syncDeviceRegistrationState
} = await import('../../src/runtime/sync-device.ts')

beforeEach(() => {
  syncCalls.length = 0
  attributeCalls.length = 0
  storedApiBaseUrls.length = 0
  storedAppKeys.length = 0
  storedDeviceIds.length = 0
  deliveryStatusFlushCalls.length = 0
  deliveryStatusFlushError = null
  deferredFlush = null
  syncState.implementation = async () => ({
    action: 'created',
    deviceId: CREATED_DEVICE_ID,
    response: { id: CREATED_DEVICE_ID }
  })
  attributeCollectionState.implementation = async () => ({
    device: {
      manufacturer: 'Apple',
      deviceType: 'phone'
    },
    app: {
      applicationId: APP_BUNDLE_ID
    }
  })
  attributeState.implementation = async () => undefined
  tokenState.registrationState = {
    platform: 'android',
    tokenType: 'fcm',
    token: FCM_TOKEN,
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true
  }
})

test('syncDeviceRegistrationState stores base URL, sends FCM token with FID, and returns snapshot data', async () => {
  const result = await syncDeviceRegistrationState({
    appId: 'app-123',
    appKey: ' app-key-1 ',
    apiBaseUrl: PADDED_API_BASE_URL,
    userId: 'user-123',
    aliasing: ['alpha'],
    appVersion: '1.0.0',
    deviceId: null,
    registrationState: tokenState.registrationState
  })

  assert.deepEqual(storedApiBaseUrls, [API_BASE_URL])
  assert.deepEqual(storedAppKeys, ['app-key-1'])
  assert.deepEqual(storedDeviceIds, [CREATED_DEVICE_ID])
  assert.deepEqual(deliveryStatusFlushCalls, [
    {
      deviceId: CREATED_DEVICE_ID,
      apiBaseUrl: API_BASE_URL,
      appKey: 'app-key-1'
    }
  ])
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appKey: 'app-key-1',
      deviceId: CREATED_DEVICE_ID,
      attributes: {
        device: {
          manufacturer: 'Apple',
          deviceType: 'phone'
        },
        app: {
          applicationId: APP_BUNDLE_ID
        }
      }
    }
  ])
  assert.deepEqual(syncCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appId: 'app-123',
      appKey: 'app-key-1',
      userId: 'user-123',
      aliasing: ['alpha'],
      appVersion: '1.0.0',
      deviceId: null,
      installationId: undefined,
      oneSignalSubscriptionId: undefined,
      platform: 'android',
      pushToken: FCM_TOKEN,
      fid: 'fid-123',
      notificationsEnabled: true
    }
  ])
  assert.deepEqual(result, {
    action: 'created',
    deviceId: CREATED_DEVICE_ID,
    pushToken: FCM_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'succeeded',
      error: null
    }
  })
})

test('syncDeviceRegistrationState sends FID as push token when FID registration is enabled', async () => {
  tokenState.registrationState = {
    platform: 'android',
    tokenType: 'fid',
    token: 'fid-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true
  }

  const result = await syncDeviceRegistrationState({
    appId: 'app-fid',
    appKey: 'app-key-fid',
    apiBaseUrl: API_BASE_URL,
    userId: 'user-fid',
    deviceId: null,
    registrationState: tokenState.registrationState
  })

  assert.equal(syncCalls[0]?.pushToken, 'fid-123')
  assert.equal(syncCalls[0]?.fid, 'fid-123')
  assert.equal(result.pushToken, 'fid-123')
  assert.equal(result.tokenType, 'fid')
})

test('syncDeviceRegistrationState skips installation-id lookup when notifications are disabled', async () => {
  tokenState.registrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    fid: null,
    permissionStatus: 'denied',
    notificationsEnabled: false
  }
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: EXISTING_DEVICE_ID,
    response: { id: EXISTING_DEVICE_ID }
  })

  const result = await syncDeviceRegistrationState({
    appId: 'app-456',
    appKey: 'app-key-2',
    apiBaseUrl: API_BASE_URL,
    userId: 'user-456',
    deviceId: EXISTING_DEVICE_ID,
    registrationState: tokenState.registrationState
  })

  assert.equal(syncCalls[0]?.fid, null)
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appKey: 'app-key-2',
      deviceId: EXISTING_DEVICE_ID,
      attributes: {
        device: {
          manufacturer: 'Apple',
          deviceType: 'phone'
        },
        app: {
          applicationId: APP_BUNDLE_ID
        }
      }
    }
  ])
  assert.deepEqual(result, {
    action: 'updated',
    deviceId: EXISTING_DEVICE_ID,
    pushToken: null,
    tokenType: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
    attributeSync: {
      status: 'succeeded',
      error: null
    }
  })
})

test('syncDeviceRegistrationState wraps sync failures with a snapshot-rich error', async () => {
  syncState.implementation = async () => {
    throw new Error('sync failed')
  }

  await assert.rejects(
    () =>
      syncDeviceRegistrationState({
        appId: 'app-789',
        appKey: 'app-key-3',
        apiBaseUrl: API_BASE_URL,
        userId: 'user-789',
        deviceId: 'device-789',
        registrationState: tokenState.registrationState
      }),
    (error: unknown) => {
      assert.ok(error instanceof BubblesNotificationsSyncError)
      assert.equal(error.message, 'sync failed')
      assert.deepEqual(error.snapshot, {
        deviceId: 'device-789',
        pushToken: FCM_TOKEN,
        tokenType: 'fcm',
        permissionStatus: 'granted',
        notificationsEnabled: true
      })

      return true
    }
  )

  assert.deepEqual(storedApiBaseUrls, [API_BASE_URL])
  assert.deepEqual(storedDeviceIds, [])
})

test('syncDeviceRegistrationState reports attribute collection failures after registration succeeds', async () => {
  const attributeError = new Error('attribute collection failed')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  attributeCollectionState.implementation = async () => {
    throw attributeError
  }

  const result = await syncDeviceRegistrationState({
    appId: 'app-attributes',
    appKey: 'app-key-attributes',
    apiBaseUrl: API_BASE_URL,
    userId: 'user-attributes',
    deviceId: null,
    registrationState: tokenState.registrationState
  })

  assert.deepEqual(storedDeviceIds, [CREATED_DEVICE_ID])
  assert.deepEqual(attributeCalls, [])
  assert.deepEqual(result, {
    action: 'created',
    deviceId: CREATED_DEVICE_ID,
    pushToken: FCM_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'failed',
      error: attributeError
    }
  })
  assert.equal(consoleError.mock.calls.length, 1)

  consoleError.mockRestore()
})

test('syncDeviceRegistrationState reports attribute update failures after registration succeeds', async () => {
  const attributeError = new Error('attribute update failed')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  attributeState.implementation = async () => {
    throw attributeError
  }

  const result = await syncDeviceRegistrationState({
    appId: 'app-attributes',
    appKey: 'app-key-attributes',
    apiBaseUrl: API_BASE_URL,
    userId: 'user-attributes',
    deviceId: null,
    registrationState: tokenState.registrationState
  })

  assert.deepEqual(storedDeviceIds, [CREATED_DEVICE_ID])
  assert.equal(attributeCalls.length, 1)
  assert.deepEqual(result, {
    action: 'created',
    deviceId: CREATED_DEVICE_ID,
    pushToken: FCM_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    attributeSync: {
      status: 'failed',
      error: attributeError
    }
  })
  assert.equal(consoleError.mock.calls.length, 1)

  consoleError.mockRestore()
})

test('syncDeviceRegistrationState keeps registration successful when delivery-status flush fails', async () => {
  deliveryStatusFlushError = new Error('delivery status unavailable')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

  const result = await syncDeviceRegistrationState({
    appId: 'app-delivery-status',
    appKey: 'app-key-delivery-status',
    apiBaseUrl: API_BASE_URL,
    userId: 'user-delivery-status',
    deviceId: null,
    registrationState: tokenState.registrationState
  })

  assert.equal(result.deviceId, CREATED_DEVICE_ID)
  assert.equal(deliveryStatusFlushCalls.length, 1)
  assert.equal(attributeCalls.length, 1)
  assert.equal(consoleError.mock.calls.length, 1)

  consoleError.mockRestore()
})

test('deferred post-registration requests do not hold up enrollment or each other', async () => {
  let finishAttributes!: () => void
  let finishFlush!: () => void
  const attributeRequest = new Promise<void>(resolve => { finishAttributes = resolve })
  const flushRequest = new Promise<void>(resolve => { finishFlush = resolve })

  attributeState.implementation = async () => attributeRequest
  deferredFlush = flushRequest

  const result = await syncDeviceRegistrationState({
    appId: 'app-123', appKey: 'app-key-123', apiBaseUrl: API_BASE_URL,
    userId: 'user-123', deviceId: null, registrationState: tokenState.registrationState,
    deferPostRegistrationWork: true
  })

  assert.equal(result.deviceId, CREATED_DEVICE_ID)
  assert.deepEqual(storedDeviceIds, [CREATED_DEVICE_ID])
  assert.equal(result.attributeSync.status, 'pending')
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
  assert.equal(deliveryStatusFlushCalls.length, 1)
  assert.equal(attributeCalls.length, 1)

  finishAttributes()
  finishFlush()
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
})
