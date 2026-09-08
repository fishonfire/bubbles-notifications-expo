import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

type MockPermissions = {
  granted: boolean;
  status: string;
  ios?: {
    status?: number;
  };
};

const platform = {
  OS: 'android',
};
const permissionCalls: Array<Record<string, unknown> | undefined> = [];
const permissionState = {
  permissions: {
    granted: true,
    status: 'granted',
  } as MockPermissions,
  description: 'granted',
  granted: true,
};
const messagingCalls = {
  getMessaging: 0,
  isDeviceRegisteredForRemoteMessages: 0,
  registerDeviceForRemoteMessages: 0,
  getToken: 0,
};
const messagingState = {
  token: 'token-123' as unknown,
  error: null as unknown,
};
const isDeviceRegisteredState = {
  value: false,
};
const messagingInstance = { mock: true };

vi.doMock('react-native', () => ({
  Platform: platform,
}));

vi.doMock('../../src/runtime/permissions.ts', () => ({
  getNotificationPermissions: async (
    options?: Record<string, unknown>,
  ) => {
    permissionCalls.push(options);
    return permissionState.permissions;
  },
  describeNotificationPermissionStatus: () => permissionState.description,
  isNotificationPermissionGranted: () => permissionState.granted,
}));

vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => {
    messagingCalls.getMessaging += 1;
    return messagingInstance;
  },
  isDeviceRegisteredForRemoteMessages: () => {
    messagingCalls.isDeviceRegisteredForRemoteMessages += 1;
    return isDeviceRegisteredState.value;
  },
  registerDeviceForRemoteMessages: async () => {
    messagingCalls.registerDeviceForRemoteMessages += 1;
    isDeviceRegisteredState.value = true;
  },
  getToken: async () => {
    messagingCalls.getToken += 1;

    if (messagingState.error) {
      throw messagingState.error;
    }

    return messagingState.token;
  },
}));

const {
  getDeviceRegistrationState,
  getDeviceToken,
  getFCMToken,
} = await import('../../src/runtime/tokens.ts');

beforeEach(() => {
  platform.OS = 'android';
  permissionCalls.length = 0;
  permissionState.permissions = {
    granted: true,
    status: 'granted',
  };
  permissionState.description = 'granted';
  permissionState.granted = true;
  messagingCalls.getMessaging = 0;
  messagingCalls.isDeviceRegisteredForRemoteMessages = 0;
  messagingCalls.registerDeviceForRemoteMessages = 0;
  messagingCalls.getToken = 0;
  isDeviceRegisteredState.value = false;
  messagingState.token = 'token-123';
  messagingState.error = null;
});

test('getDeviceRegistrationState returns a disabled snapshot when permission is denied', async () => {
  permissionState.permissions = {
    granted: false,
    status: 'denied',
  };
  permissionState.description = 'denied';
  permissionState.granted = false;

  const result = await getDeviceRegistrationState({
    requestPermissions: false,
  });

  assert.deepEqual(permissionCalls, [{ requestPermissions: false }]);
  assert.deepEqual(result, {
    platform: 'android',
    tokenType: null,
    token: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  });
  assert.equal(messagingCalls.getMessaging, 0);
});

test('getDeviceRegistrationState registers remote messages and returns the FCM token', async () => {
  const result = await getDeviceRegistrationState();

  assert.equal(messagingCalls.getMessaging, 1);
  assert.equal(messagingCalls.isDeviceRegisteredForRemoteMessages, 1);
  assert.equal(messagingCalls.registerDeviceForRemoteMessages, 1);
  assert.equal(messagingCalls.getToken, 1);
  assert.deepEqual(result, {
    platform: 'android',
    tokenType: 'fcm',
    token: 'token-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
  assert.equal(await getFCMToken(), 'token-123');
});

test('getDeviceToken rejects when notification permission is not granted', async () => {
  permissionState.granted = false;
  permissionState.permissions = {
    granted: false,
    status: 'denied',
  };
  permissionState.description = 'denied';

  await assert.rejects(
    () => getDeviceToken(),
    /Push notification permission was not granted\./,
  );
});

test('getDeviceRegistrationState rejects unsupported platforms', async () => {
  platform.OS = 'web';

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /Unsupported platform: web\. This package only supports iOS and Android\./,
  );
});

test('Firebase token failures include the iOS setup hint', async () => {
  platform.OS = 'ios';
  messagingState.error = new Error('messaging misconfigured');

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /expo\.ios\.googleServicesFile/,
  );
  await assert.rejects(
    () => getDeviceRegistrationState(),
    /Firebase APNs setup is complete/,
  );
});

test('empty Firebase tokens are rejected with a token-source-specific error', async () => {
  messagingState.token = '   ';

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /android FCM token from Firebase Messaging must not be empty\./,
  );
});
