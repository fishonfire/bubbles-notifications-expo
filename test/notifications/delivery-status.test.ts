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

  async text() {
    return this.textSync();
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
  readStoredDeviceStateAsync: async () => storedDeviceState,
}));

vi.doMock('expo-file-system/legacy', () => ({
  writeAsStringAsync: async (uri: string, value: string) => {
    fileContents.set(uri, value);
  },
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
  observeStoredBubblesLocalDisplayRequested,
  observeStoredBubblesNotificationClicked,
  observeStoredBubblesNotificationReceived,
  postStoredBubblesDeliveryStatus,
} = await import('../../src/notifications/delivery-status.ts');
const {
  readStoredDeliveryStatusLedger,
  createStoredDeliveryStatusEvent,
  enqueueStoredDeliveryStatusEventAsync,
  storeDeliveryStatusLedger,
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

test('maps notification observations to their defined delivery statuses', async () => {
  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await observeStoredBubblesNotificationReceived({
    source: 'foreground',
    notificationId: 'notification-1',
  });
  await observeStoredBubblesLocalDisplayRequested({
    source: 'foreground',
    notificationId: 'notification-1',
  });
  await observeStoredBubblesNotificationClicked({
    source: 'response',
    notificationId: 'notification-1',
  });

  assert.deepEqual(
    postDeliveryStatusCalls.map((call) => call.status),
    ['received', 'shown', 'clicked'],
  );
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

test('deduplicates clicked delivery statuses once per notification', async () => {
  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'clicked',
  });
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'clicked',
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
    ],
  );
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, []);
  assert.equal(readStoredDeliveryStatusLedger().postedEventKeys.length, 1);
});

test('migration drops pending clicks already posted under another action key', async () => {
  const ledgerUri = `${documentDirectory}/bubbles-notifications-expo-delivery-status-ledger.json`;
  const createdAt = new Date().toISOString();
  const defaultActionKey = JSON.stringify([
    'notification-1',
    'clicked',
    null,
    'default',
  ]);
  const customActionKey = JSON.stringify([
    'notification-1',
    'clicked',
    null,
    'custom',
  ]);

  fileContents.set(
    ledgerUri,
    JSON.stringify({
      version: 1,
      pendingEvents: [
        {
          key: defaultActionKey,
          notificationId: 'notification-1',
          status: 'clicked',
          actionId: 'default',
          createdAt,
        },
        {
          key: customActionKey,
          notificationId: 'notification-1',
          status: 'clicked',
          actionId: 'custom',
          createdAt,
        },
      ],
      postedEventKeys: [defaultActionKey, customActionKey],
    }),
  );

  const ledger = readStoredDeliveryStatusLedger();

  assert.deepEqual(ledger.pendingEvents, []);
  assert.deepEqual(ledger.postedEventKeys, [
    JSON.stringify(['notification-1', 'clicked', null]),
  ]);

  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';
  await flushStoredBubblesDeliveryStatuses();
  assert.deepEqual(postDeliveryStatusCalls, []);
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

test('serializes concurrent delivery-status ledger enqueues', async () => {
  const events = ['notification-1', 'notification-2', 'notification-3'].map(
    (notificationId) =>
      createStoredDeliveryStatusEvent({
        notificationId,
        status: 'received',
      }),
  );

  await Promise.all(
    events.map((event) => enqueueStoredDeliveryStatusEventAsync(event)),
  );

  assert.deepEqual(
    readStoredDeliveryStatusLedger().pendingEvents.map(
      (event) => event.notificationId,
    ),
    ['notification-1', 'notification-2', 'notification-3'],
  );
});

test('serializes concurrent enqueue and flush operations without duplicate sends', async () => {
  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await Promise.all([
    postStoredBubblesDeliveryStatus({
      source: 'test',
      notificationId: 'notification-1',
      status: 'received',
    }),
    postStoredBubblesDeliveryStatus({
      source: 'test',
      notificationId: 'notification-2',
      status: 'shown',
    }),
    flushStoredBubblesDeliveryStatuses(),
    flushStoredBubblesDeliveryStatuses(),
  ]);

  assert.deepEqual(
    postDeliveryStatusCalls.map((call) => call.notificationId),
    ['notification-1', 'notification-2'],
  );
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, []);
});

test('prevents concurrent flushes from posting the same queued event', async () => {
  await postStoredBubblesDeliveryStatus({
    source: 'test',
    notificationId: 'notification-1',
    status: 'received',
  });

  storedDeviceState.deviceId = 'device-1';
  storedDeviceState.apiBaseUrl = 'https://api.example.com';
  storedDeviceState.appKey = 'app-key-1';

  await Promise.all([
    flushStoredBubblesDeliveryStatuses(),
    flushStoredBubblesDeliveryStatuses(),
  ]);

  assert.equal(postDeliveryStatusCalls.length, 1);
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, []);
});

test('evicts pending events older than seven days', () => {
  const recentEvent = createStoredDeliveryStatusEvent({
    notificationId: 'recent-notification',
    status: 'received',
  });
  const expiredEvent = {
    ...createStoredDeliveryStatusEvent({
      notificationId: 'expired-notification',
      status: 'received',
    }),
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  };

  storeDeliveryStatusLedger({
    pendingEvents: [expiredEvent, recentEvent],
    postedEventKeys: [],
  });

  assert.deepEqual(
    readStoredDeliveryStatusLedger().pendingEvents.map(
      (event) => event.notificationId,
    ),
    ['recent-notification'],
  );
});

test('retains only the newest 200 pending events and posted keys', () => {
  const pendingEvents = Array.from({ length: 205 }, (_, index) =>
    createStoredDeliveryStatusEvent({
      notificationId: `notification-${index}`,
      status: 'received',
    }),
  );
  const postedEventKeys = Array.from(
    { length: 205 },
    (_, index) => `posted-${index}`,
  );

  storeDeliveryStatusLedger({ pendingEvents, postedEventKeys });

  const ledger = readStoredDeliveryStatusLedger();
  assert.equal(ledger.pendingEvents.length, 200);
  assert.equal(ledger.pendingEvents[0]?.notificationId, 'notification-5');
  assert.equal(ledger.postedEventKeys.length, 200);
  assert.equal(ledger.postedEventKeys[0], 'posted-5');
});

test('migration keeps one unposted click across legacy action keys', () => {
  const event = createStoredDeliveryStatusEvent({ notificationId: 'unposted-click', status: 'clicked' });
  fileContents.set(
    `${documentDirectory}/bubbles-notifications-expo-delivery-status-ledger.json`,
    JSON.stringify({
      version: 1,
      pendingEvents: ['default', 'custom'].map(actionId => ({
        ...event, actionId,
        key: JSON.stringify(['unposted-click', 'clicked', null, actionId]),
      })),
      postedEventKeys: [],
    }),
  );
  assert.deepEqual(readStoredDeliveryStatusLedger().pendingEvents, [event]);
});
