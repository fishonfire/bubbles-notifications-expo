import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const platformState = {
  OS: 'android',
};

const messagingCalls = {
  getMessaging: 0,
  onMessage: [] as Array<{
    messaging: unknown;
    listener: (remoteMessage: Record<string, unknown>) => void;
  }>,
  unsubscribe: 0,
};

const messagingState = {
  instance: {
    mock: true,
  },
};

const notificationState = {
  permissions: {
    granted: true,
    status: 'granted',
  },
};

const notificationCalls = {
  getPermissions: 0,
  schedule: [] as Array<Record<string, unknown>>,
};
const deliveryStatusCalls: Array<Record<string, unknown>> = [];

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

vi.doMock('react-native', () => ({
  Platform: platformState,
}));

vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => {
    messagingCalls.getMessaging += 1;
    return messagingState.instance;
  },
  onMessage: (
    messaging: unknown,
    listener: (remoteMessage: Record<string, unknown>) => void,
  ) => {
    messagingCalls.onMessage.push({
      messaging,
      listener,
    });

    return () => {
      messagingCalls.unsubscribe += 1;
    };
  },
}));

vi.doMock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 'timeInterval',
  },
  getPermissionsAsync: async () => {
    notificationCalls.getPermissions += 1;
    return notificationState.permissions;
  },
  scheduleNotificationAsync: async (
    request: Record<string, unknown>,
  ) => {
    notificationCalls.schedule.push(request);
    return 'scheduled-notification-id';
  },
}));

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  postStoredBubblesDeliveryStatus: async (
    options: Record<string, unknown>,
  ) => {
    deliveryStatusCalls.push(options);
  },
}));

vi.doMock('../../src/runtime/permissions.ts', () => ({
  isNotificationPermissionGranted: (
    permissions: Record<string, unknown>,
  ) => permissions.granted === true,
}));

const { observeBubblesForegroundMessages } = await import(
  '../../src/runtime/foreground-message-observer.ts'
);

beforeEach(() => {
  vi.resetModules();
  platformState.OS = 'android';
  messagingCalls.getMessaging = 0;
  messagingCalls.onMessage.length = 0;
  messagingCalls.unsubscribe = 0;
  notificationState.permissions = {
    granted: true,
    status: 'granted',
  };
  notificationCalls.getPermissions = 0;
  notificationCalls.schedule.length = 0;
  deliveryStatusCalls.length = 0;
});

test('foreground message observer subscribes on supported platforms and schedules a local notification', async () => {
  const cleanup = observeBubblesForegroundMessages();

  assert.equal(messagingCalls.getMessaging, 1);
  assert.equal(messagingCalls.onMessage.length, 1);
  assert.equal(
    messagingCalls.onMessage[0]?.messaging,
    messagingState.instance,
  );

  messagingCalls.onMessage[0]?.listener({
    data: {
      notification_id: 'notification-123',
      url: '/inbox',
    },
    notification: {
      title: 'Foreground title',
      body: 'Foreground body',
    },
  });

  await flushMicrotasks();

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(notificationCalls.schedule, [
    {
      content: {
        title: 'Foreground title',
        body: 'Foreground body',
        data: {
          notification_id: 'notification-123',
          url: '/inbox',
        },
      },
      trigger: {
        type: 'timeInterval',
        seconds: 1,
      },
    },
  ]);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase foreground message',
      notificationId: 'notification-123',
      status: 'shown',
    },
  ]);

  cleanup();
  assert.equal(messagingCalls.unsubscribe, 1);
});

test('foreground message observer keeps data-only messages silent', async () => {
  const cleanup = observeBubblesForegroundMessages();

  messagingCalls.onMessage[0]?.listener({
    data: {
      notification_id: 'notification-data-only',
      type: 'sync',
      resource_id: 'thread-123',
    },
  });

  await flushMicrotasks();

  assert.equal(notificationCalls.getPermissions, 0);
  assert.deepEqual(notificationCalls.schedule, []);
  assert.deepEqual(deliveryStatusCalls, []);

  cleanup();
});

test('foreground message observer skips unsupported platforms', () => {
  platformState.OS = 'web';

  const cleanup = observeBubblesForegroundMessages();

  assert.equal(messagingCalls.getMessaging, 0);
  assert.equal(messagingCalls.onMessage.length, 0);

  cleanup();
  assert.equal(messagingCalls.unsubscribe, 0);
});
