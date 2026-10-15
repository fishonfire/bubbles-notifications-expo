import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const API_BASE_URL = 'https://api.example.com'

const PADDED_API_BASE_URL = ` ${API_BASE_URL} `

const createClientCalls: Record<string, unknown>[] = []
const postDeliveryStatusCalls: {
  deviceId: string;
  notificationId: string;
  payload: Record<string, unknown>;
  requestOptions: unknown;
}[] = []

const mockClient = {
  postDeliveryStatus: async (
    deviceId: string,
    notificationId: string,
    payload: Record<string, unknown>,
    requestOptions: unknown
  ) => {
    postDeliveryStatusCalls.push({
      deviceId,
      notificationId,
      payload,
      requestOptions
    })
  }
}

vi.doMock('../../src/api/device-client.ts', () => ({
  createBubblesDeviceClient: (options: Record<string, unknown>) => {
    createClientCalls.push(options)

    return mockClient
  }
}))

const {
  buildBubblesDeliveryStatusPayload,
  postBubblesDeliveryStatus
} = await import('../../src/api/delivery-status.ts')

beforeEach(() => {
  createClientCalls.length = 0
  postDeliveryStatusCalls.length = 0
})

test('buildBubblesDeliveryStatusPayload trims the optional error text', () => {
  assert.deepEqual(
    buildBubblesDeliveryStatusPayload({
      status: 'shown',
      error: ' failed to display '
    }),
    {
      status: 'shown',
      error: 'failed to display'
    }
  )
})

test('postBubblesDeliveryStatus normalizes baseUrl and identifiers before delegating', async () => {
  await postBubblesDeliveryStatus({
    apiBaseUrl: PADDED_API_BASE_URL,
    appKey: ' app-key-1 ',
    deviceId: ' device-1 ',
    notificationId: 123,
    status: 'clicked'
  })

  assert.deepEqual(createClientCalls, [
    {
      baseUrl: API_BASE_URL,
      appKey: 'app-key-1'
    }
  ])
  assert.deepEqual(postDeliveryStatusCalls, [
    {
      deviceId: 'device-1',
      notificationId: '123',
      payload: {
        status: 'clicked'
      },
      requestOptions: {
        headers: {
          'X-App-Key': 'app-key-1'
        }
      }
    }
  ])
})

test('postBubblesDeliveryStatus rejects non-finite numeric identifiers with the current error text', async () => {
  await assert.rejects(
    () =>
      postBubblesDeliveryStatus({
        apiBaseUrl: API_BASE_URL,
        appKey: 'app-key-1',
        deviceId: Number.NaN,
        notificationId: 'notification-1',
        status: 'shown'
      }),
    /"deviceId" must be a finite number when it is numeric\./
  )

  assert.deepEqual(postDeliveryStatusCalls, [])
})
