import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const fileContents = new Map<string, string>();
const documentDirectory = '/mock/document';

class MockFile {
  readonly uri: string;

  constructor(basePath: string, fileName: string) {
    this.uri = `${basePath}/${fileName}`;
  }

  get exists() {
    return fileContents.has(this.uri);
  }

  create() {
    if (!fileContents.has(this.uri)) {
      fileContents.set(this.uri, '');
    }
  }

  textSync() {
    const value = fileContents.get(this.uri);

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`);
    }

    return value;
  }

  write(value: string) {
    fileContents.set(this.uri, value);
  }
}

const storedDeviceState = {
  deviceId: null as string | null,
  apiBaseUrl: null as string | null,
  appKey: null as string | null,
};

const postDeliveryStatusCalls: Array<Record<string, unknown>> = [];
let postDeliveryStatusError: Error | null = null;

vi.doMock('expo-file-system', () => ({
  File: MockFile,
  Paths: {
    document: documentDirectory,
  },
}));

vi.doMock('../../src/storage/device-state.ts', () => ({
  readStoredDeviceState: () => storedDeviceState,
}));

vi.doMock('../../src/api/delivery-status.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/api/delivery-status.ts')>();

  return {
    ...original,
    postBubblesDeliveryStatus: async (options: Record<string, unknown>) => {
      postDeliveryStatusCalls.push(options);

      if (postDeliveryStatusError) {
        throw postDeliveryStatusError;
      }
    },
  };
});

const {
  flushStoredBubblesDeliveryStatuses,
  postStoredBubblesDeliveryStatus,
} = await import('../../src/notifications/delivery-status.ts');
const {
  readStoredDeliveryStatusLedger,
} = await import('../../src/storage/delivery-status-ledger.ts');

beforeEach(() => {
  fileContents.clear();
  storedDeviceState.deviceId = null;
  storedDeviceState.apiBaseUrl = null;
  storedDeviceState.appKey = null;
  postDeliveryStatusCalls.length = 0;
  postDeliveryStatusError = null;
});

test('queues delivery statuses when device state and api base URL are missing', async () => {
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'received',
  });

  assert.deepEqual(postDeliveryStatusCalls, []);
  assert.equal(readStoredDeliveryStatusLedger().pendingEvents.length, 1);
});

test('flushes queued delivery statuses after app restart when device state is available', async () => {
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'received',
  });

  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await flushStoredBubblesDeliveryStatuses();

  assert.deepEqual(postDeliveryStatusCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-1',
      deviceId: 'device-1',
      notificationId: 'notification-1',
      status: 'received',
      error: undefined,
    },
  ]);
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, []);
  assert.equal(readStoredDeliveryStatusLedger().postedEventKeys.length, 1);
});

test('deduplicates pending and already posted delivery statuses by action id', async () => {
  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'clicked',
    actionId: 'default',
  });
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'clicked',
    actionId: 'default',
  });
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'clicked',
    actionId: 'custom',
  });

  assert.deepEqual(
    postDeliveryStatusCalls.map((call) => ({
      notificationId: call.notificationId,
      status: call.status,
    })),
    [
      {
        notificationId: 'notification-1',
        status: 'clicked',
      },
      {
        notificationId: 'notification-1',
        status: 'clicked',
      },
    ],
  );
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, []);
  assert.equal(readStoredDeliveryStatusLedger().postedEventKeys.length, 2);
});

test('leaves failed delivery statuses queued for retry', async () => {
  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';
  postDeliveryStatusError = new Error('network unavailable');

  await assert.rejects(
    () =>
      postStoredBubblesDeliveryStatus({
        source: 'test',
        notificationId: 'notification-1',
        status: 'shown',
      }),
    /network unavailable/,
  );

  assert.equal(readStoredDeliveryStatusLedger().pendingEvents.length, 1);
});
