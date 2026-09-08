import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

import type { BubblesNotificationResponseEvent } from '../../src/runtime/context.ts';

type MockNotification = {
  request: {
    identifier: string;
    content: {
      data: Record<string, unknown>;
    };
  };
};

type MockNotificationResponse = {
  actionIdentifier: string;
  notification: MockNotification;
};

const notificationSubscriptions = {
  listener: null as null | ((response: MockNotificationResponse) => void),
  clearCallCount: 0,
  removeCallCount: 0,
  lastResponse: null as MockNotificationResponse | null,
};
const storedDeviceState = {
  deviceId: 'device-123',
  apiBaseUrl: 'https://api.example.com',
  appKey: 'app-key-123',
};
const deliveryStatusCalls: Array<Record<string, unknown>> = [];
const callbackEvents: BubblesNotificationResponseEvent[] = [];

vi.doMock('expo-notifications', () => ({
  getLastNotificationResponse: () => notificationSubscriptions.lastResponse,
  clearLastNotificationResponse: () => {
    notificationSubscriptions.clearCallCount += 1;
  },
  addNotificationResponseReceivedListener: (
    listener: (response: MockNotificationResponse) => void,
  ) => {
    notificationSubscriptions.listener = listener;

    return {
      remove: () => {
        notificationSubscriptions.removeCallCount += 1;
        notificationSubscriptions.listener = null;
      },
    };
  },
}));

vi.doMock('../../src/storage/device-state.ts', () => ({
  readStoredDeviceState: () => storedDeviceState,
}));

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  postStoredBubblesDeliveryStatus: async (options: Record<string, unknown>) => {
    deliveryStatusCalls.push(options);
    return storedDeviceState;
  },
}));

vi.doMock('../../src/notifications/payload.ts', () => ({
  getBubblesNotificationDataFromNotification: (
    notification: MockNotification,
  ) => notification.request.content.data,
  normalizeBubblesNotificationPayload: (data: Record<string, unknown>) => ({
    data,
    notificationId:
      typeof data.notification_id === 'string' ? data.notification_id : null,
    messageTitle: null,
    body: null,
    url: typeof data.url === 'string' ? data.url : null,
  }),
}));

function createResponse(
  identifier: string,
  data: Record<string, unknown>,
  actionIdentifier = 'expo.modules.notifications.actions.DEFAULT',
): MockNotificationResponse {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier,
        content: {
          data,
        },
      },
    },
  };
}

const { observeBubblesNotificationResponses } = await import(
  '../../src/runtime/response-observer.ts'
);

beforeEach(() => {
  notificationSubscriptions.listener = null;
  notificationSubscriptions.clearCallCount = 0;
  notificationSubscriptions.removeCallCount = 0;
  notificationSubscriptions.lastResponse = null;
  deliveryStatusCalls.length = 0;
  callbackEvents.length = 0;
});

test('processes the last notification response on startup and delegates navigation data', () => {
  notificationSubscriptions.lastResponse = createResponse('notif-1', {
    url: '/fish',
    notification_id: 'notification-1',
    custom: 'value',
  });

  const cleanup = observeBubblesNotificationResponses({
    onNotificationResponse(event) {
      callbackEvents.push(event);
    },
  });

  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'notification response',
      storedDeviceState,
      notificationId: 'notification-1',
      status: 'clicked',
      actionId: 'expo.modules.notifications.actions.DEFAULT',
    },
  ]);
  assert.equal(notificationSubscriptions.clearCallCount, 1);
  assert.deepEqual(callbackEvents, [
    {
      notification: notificationSubscriptions.lastResponse.notification,
      data: {
        url: '/fish',
        notification_id: 'notification-1',
        custom: 'value',
      },
      deviceId: 'device-123',
      url: '/fish',
      notificationId: 'notification-1',
    },
  ]);

  cleanup();
  assert.equal(notificationSubscriptions.removeCallCount, 1);
});

test('deduplicates repeated responses with the same response key while handling distinct live taps', () => {
  const repeatedResponse = createResponse('notif-2', {
    url: '/explore',
    notification_id: 'notification-2',
  });
  const distinctResponse = createResponse('notif-3', {
    url: '/home',
    notification_id: 'notification-3',
  });
  notificationSubscriptions.lastResponse = repeatedResponse;

  observeBubblesNotificationResponses({
    onNotificationResponse(event) {
      callbackEvents.push(event);
    },
  });

  notificationSubscriptions.listener?.(repeatedResponse);
  notificationSubscriptions.listener?.(distinctResponse);

  assert.equal(deliveryStatusCalls.length, 2);
  assert.deepEqual(
    deliveryStatusCalls.map((call) => call.notificationId),
    ['notification-2', 'notification-3'],
  );
  assert.deepEqual(
    callbackEvents,
    [
      {
        notification: repeatedResponse.notification,
        url: '/explore',
        notificationId: 'notification-2',
        deviceId: 'device-123',
        data: {
          url: '/explore',
          notification_id: 'notification-2',
        },
      },
      {
        notification: distinctResponse.notification,
        url: '/home',
        notificationId: 'notification-3',
        deviceId: 'device-123',
        data: {
          url: '/home',
          notification_id: 'notification-3',
        },
      },
    ],
  );
});

test('deduplicates responses with the same notification id and action across request identifiers', () => {
  const startupResponse = createResponse('expo-request-1', {
    url: '/explore',
    notification_id: 'notification-shared',
  });
  const liveResponse = createResponse('expo-request-2', {
    url: '/explore',
    notification_id: 'notification-shared',
  });
  notificationSubscriptions.lastResponse = startupResponse;

  observeBubblesNotificationResponses({
    onNotificationResponse(event) {
      callbackEvents.push(event);
    },
  });

  notificationSubscriptions.listener?.(liveResponse);

  assert.deepEqual(
    deliveryStatusCalls.map((call) => call.notificationId),
    ['notification-shared'],
  );
  assert.equal(callbackEvents.length, 1);
});

test('treats different action identifiers for the same notification identifier as distinct responses', () => {
  const defaultActionResponse = createResponse('notif-4', {
    url: '/offers',
    notification_id: 'notification-4',
  });
  const customActionResponse = createResponse(
    'notif-4',
    {
      url: '/offers',
      notification_id: 'notification-4',
    },
    'custom-action',
  );

  observeBubblesNotificationResponses({
    onNotificationResponse(event) {
      callbackEvents.push(event);
    },
  });

  notificationSubscriptions.listener?.(defaultActionResponse);
  notificationSubscriptions.listener?.(customActionResponse);

  assert.equal(deliveryStatusCalls.length, 2);
  assert.equal(callbackEvents.length, 2);
});
