import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const platformState = {
  OS: 'android',
};

const messagingCalls = {
  getMessaging: 0,
  setBackgroundMessageHandler: [] as Array<{
    messaging: unknown;
    handler: (remoteMessage: Record<string, unknown>) => Promise<void>;
  }>,
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
  scheduleError: null as Error | null,
};
const deliveryStatusCalls: Array<Record<string, unknown>> = [];

vi.doMock('react-native', () => ({
  Platform: platformState,
}));

vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => {
    messagingCalls.getMessaging += 1;
    return messagingState.instance;
  },
  setBackgroundMessageHandler: (
    messaging: unknown,
    handler: (remoteMessage: Record<string, unknown>) => Promise<void>,
  ) => {
    messagingCalls.setBackgroundMessageHandler.push({
      messaging,
      handler,
    });
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

    if (notificationCalls.scheduleError) {
      throw notificationCalls.scheduleError;
    }

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

beforeEach(() => {
  vi.resetModules();
  platformState.OS = 'android';
  messagingCalls.getMessaging = 0;
  messagingCalls.setBackgroundMessageHandler.length = 0;
  notificationState.permissions = {
    granted: true,
    status: 'granted',
  };
  notificationCalls.getPermissions = 0;
  notificationCalls.schedule.length = 0;
  notificationCalls.scheduleError = null;
  deliveryStatusCalls.length = 0;
});

test('firebase background message handler registers on supported platforms', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  assert.equal(messagingCalls.getMessaging, 1);
  assert.equal(messagingCalls.setBackgroundMessageHandler.length, 1);
  assert.equal(
    messagingCalls.setBackgroundMessageHandler[0]?.messaging,
    messagingState.instance,
  );
  assert.equal(
    typeof messagingCalls.setBackgroundMessageHandler[0]?.handler,
    'function',
  );
});

test('firebase background message handler registration is idempotent', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();
  registerBubblesFirebaseBackgroundMessageHandler();

  assert.equal(messagingCalls.getMessaging, 1);
  assert.equal(messagingCalls.setBackgroundMessageHandler.length, 1);
});

test('firebase background message handler skips unsupported platforms', async () => {
  platformState.OS = 'web';

  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  assert.equal(messagingCalls.getMessaging, 0);
  assert.equal(messagingCalls.setBackgroundMessageHandler.length, 0);
});

test('firebase background message handler schedules a local notification for Android data-only messages', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  await messagingCalls.setBackgroundMessageHandler[0]?.handler({
    data: {
      notification_id: 'notification-123',
      message_title: 'Background title',
      body: 'Background body',
      url: '/inbox',
    },
  });

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase background message',
      notificationId: 'notification-123',
      status: 'received',
    },
    {
      source: 'Firebase background message',
      notificationId: 'notification-123',
      status: 'shown',
    },
  ]);
  assert.deepEqual(notificationCalls.schedule, [
    {
      content: {
        title: 'Background title',
        body: 'Background body',
        data: {
          notification_id: 'notification-123',
          message_title: 'Background title',
          body: 'Background body',
          url: '/inbox',
        },
      },
      trigger: {
        type: 'timeInterval',
        seconds: 1,
      },
    },
  ]);
});

test('firebase background message handler does not schedule local notifications for iOS data-only messages', async () => {
  platformState.OS = 'ios';

  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  await messagingCalls.setBackgroundMessageHandler[0]?.handler({
    data: {
      notification_id: 'notification-ios-data',
      message_title: 'Background title',
      body: 'Background body',
      url: '/inbox',
    },
  });

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase background message',
      notificationId: 'notification-ios-data',
      status: 'received',
    },
  ]);
  assert.deepEqual(notificationCalls.schedule, []);
});

test('firebase background message handler posts the notifications-disabled status when permissions are denied', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  notificationState.permissions = {
    granted: false,
    status: 'denied',
  };

  await messagingCalls.setBackgroundMessageHandler[0]?.handler({
    data: {
      notification_id: 'notification-456',
    },
  });

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase background message',
      notificationId: 'notification-456',
      status: 'disabled',
    },
  ]);
  assert.deepEqual(notificationCalls.schedule, []);
});

test('firebase background message handler does not recreate Firebase display notifications locally', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  await messagingCalls.setBackgroundMessageHandler[0]?.handler({
    data: {
      notification_id: 'notification-789',
      url: '/offers',
    },
    notification: {
      title: 'Remote title',
      body: 'Remote body',
    },
  });

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase background message',
      notificationId: 'notification-789',
      status: 'received',
    },
  ]);
  assert.deepEqual(notificationCalls.schedule, []);
});

test('firebase background message handler posts a delivery error before rethrowing scheduling failures', async () => {
  const {
    registerBubblesFirebaseBackgroundMessageHandler,
  } = await import('../../src/background/firebase-message-handler.ts');

  registerBubblesFirebaseBackgroundMessageHandler();

  notificationCalls.scheduleError = new Error('boom');

  await assert.rejects(
    () =>
      messagingCalls.setBackgroundMessageHandler[0]?.handler({
        data: {
          notification_id: 'notification-999',
          url: '/alerts',
        },
      }) ?? Promise.resolve(),
    /boom/,
  );

  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(deliveryStatusCalls, [
    {
      source: 'Firebase background message',
      notificationId: 'notification-999',
      status: 'received',
    },
    {
      source: 'Firebase background message',
      notificationId: 'notification-999',
      error: 'Failed to show notification: boom',
    },
  ]);
  assert.deepEqual(notificationCalls.schedule, [
    {
      content: {
        title: 'Background notification received',
        body: 'Open the app to view this update.',
        data: {
          notification_id: 'notification-999',
          url: '/alerts',
        },
      },
      trigger: {
        type: 'timeInterval',
        seconds: 1,
      },
    },
  ]);
});
