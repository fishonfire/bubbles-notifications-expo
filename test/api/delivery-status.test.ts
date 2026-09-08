import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const createClientCalls: Array<Record<string, unknown>> = [];
const postDeliveryStatusCalls: Array<{
  deviceId: string;
  notificationId: string;
  payload: Record<string, unknown>;
  requestOptions: unknown;
}> = [];

const mockClient = {
  postDeliveryStatus: async (
    deviceId: string,
    notificationId: string,
    payload: Record<string, unknown>,
    requestOptions: unknown,
  ) => {
    postDeliveryStatusCalls.push({
      deviceId,
      notificationId,
      payload,
      requestOptions,
    });
  },
};

vi.doMock('../../src/api/device-client.ts', () => ({
  createBubblesDeviceClient: (options: Record<string, unknown>) => {
    createClientCalls.push(options);
    return mockClient;
  },
}));

const {
  buildBubblesDeliveryStatusPayload,
  postBubblesDeliveryStatus,
} = await import('../../src/api/delivery-status.ts');

beforeEach(() => {
  createClientCalls.length = 0;
  postDeliveryStatusCalls.length = 0;
});

test('buildBubblesDeliveryStatusPayload trims the optional error text', () => {
  assert.deepEqual(
    buildBubblesDeliveryStatusPayload({
      status: 'shown',
      error: ' failed to display ',
    }),
    {
      status: 'shown',
      error: 'failed to display',
    },
  );
});

test('postBubblesDeliveryStatus normalizes baseUrl and identifiers before delegating', async () => {
  await postBubblesDeliveryStatus({
    apiBaseUrl: ' https://api.example.com ',
    appKey: ' app-key-1 ',
    deviceId: ' device-1 ',
    notificationId: 123,
    status: 'clicked',
  });

  assert.deepEqual(createClientCalls, [
    {
      baseUrl: 'https://api.example.com',
      appKey: 'app-key-1',
    },
  ]);
  assert.deepEqual(postDeliveryStatusCalls, [
    {
      deviceId: 'device-1',
      notificationId: '123',
      payload: {
        status: 'clicked',
      },
      requestOptions: {
        headers: {
          'X-App-Key': 'app-key-1',
        },
      },
    },
  ]);
});

test('postBubblesDeliveryStatus rejects non-finite numeric identifiers with the current error text', async () => {
  await assert.rejects(
    () =>
      postBubblesDeliveryStatus({
        apiBaseUrl: 'https://api.example.com',
        appKey: 'app-key-1',
        deviceId: Number.NaN,
        notificationId: 'notification-1',
        status: 'shown',
      }),
    /"deviceId" must be a finite number when it is numeric\./,
  );

  assert.deepEqual(postDeliveryStatusCalls, []);
});
