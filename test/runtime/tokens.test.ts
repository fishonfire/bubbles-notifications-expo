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
const installationCalls: string[] = [];
const installationState = {
  installationId: 'fid-123',
  error: null as unknown,
};
const messagingCalls = {
  getMessaging: 0,
  isDeviceRegisteredForRemoteMessages: 0,
  registerDeviceForRemoteMessages: 0,
  getToken: 0,
};
const messagingState = {
  isRegistered: true,
  token: ' fcm-token-123 ',
};
const runtimeConfigState = {
  enableFirebaseInstallationPushRegistration: false,
};

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

vi.doMock('../../src/runtime/installations.ts', () => ({
  getFirebaseInstallationId: async (requestedPlatform: string) => {
    installationCalls.push(requestedPlatform);

    if (installationState.error) {
      throw installationState.error;
    }

    return installationState.installationId;
  },
}));

vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => {
    messagingCalls.getMessaging += 1;
    return { app: 'messaging' };
  },
  isDeviceRegisteredForRemoteMessages: () => {
    messagingCalls.isDeviceRegisteredForRemoteMessages += 1;
    return messagingState.isRegistered;
  },
  registerDeviceForRemoteMessages: async () => {
    messagingCalls.registerDeviceForRemoteMessages += 1;
  },
  getToken: async () => {
    messagingCalls.getToken += 1;
    return messagingState.token;
  },
}));

vi.doMock('../../src/config/runtime-config.ts', () => ({
  getBubblesNotificationsRuntimeConfig: () => ({
    defaultChannelId: 'default',
    defaultChannelName: 'Default',
    androidChannelImportance: 'max',
    enableFirebaseInstallationPushRegistration:
      runtimeConfigState.enableFirebaseInstallationPushRegistration,
  }),
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
  installationCalls.length = 0;
  installationState.installationId = 'fid-123';
  installationState.error = null;
  messagingCalls.getMessaging = 0;
  messagingCalls.isDeviceRegisteredForRemoteMessages = 0;
  messagingCalls.registerDeviceForRemoteMessages = 0;
  messagingCalls.getToken = 0;
  messagingState.isRegistered = true;
  messagingState.token = ' fcm-token-123 ';
  runtimeConfigState.enableFirebaseInstallationPushRegistration = false;
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
    fid: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  });
  assert.deepEqual(installationCalls, []);
  assert.equal(messagingCalls.getToken, 0);
});

test('getDeviceRegistrationState returns FCM token with Firebase installation id by default', async () => {
  const result = await getDeviceRegistrationState();

  assert.deepEqual(installationCalls, ['android']);
  assert.equal(messagingCalls.getMessaging, 1);
  assert.equal(messagingCalls.isDeviceRegisteredForRemoteMessages, 1);
  assert.equal(messagingCalls.registerDeviceForRemoteMessages, 0);
  assert.equal(messagingCalls.getToken, 1);
  assert.deepEqual(result, {
    platform: 'android',
    tokenType: 'fcm',
    token: 'fcm-token-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
  assert.equal(await getFCMToken(), 'fcm-token-123');
});

test('getDeviceRegistrationState registers remote messages before reading FCM token', async () => {
  messagingState.isRegistered = false;

  const result = await getDeviceRegistrationState();

  assert.equal(messagingCalls.registerDeviceForRemoteMessages, 1);
  assert.equal(result.token, 'fcm-token-123');
});

test('getDeviceRegistrationState returns FID as token when Firebase installation push registration is enabled', async () => {
  runtimeConfigState.enableFirebaseInstallationPushRegistration = true;

  const result = await getDeviceRegistrationState();

  assert.deepEqual(result, {
    platform: 'android',
    tokenType: 'fid',
    token: 'fid-123',
    fid: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
  assert.equal(messagingCalls.getToken, 0);
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

test('Firebase installation id failures propagate from the installation helper', async () => {
  platform.OS = 'ios';
  installationState.error = new Error(
    'Failed to get an ios Firebase installation id.',
  );

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /Failed to get an ios Firebase installation id\./,
  );
});

test('empty Firebase installation ids are rejected with a token-source-specific error', async () => {
  installationState.error = new Error(
    'android Firebase installation id from Firebase Installations must not be empty.',
  );

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /android Firebase installation id from Firebase Installations must not be empty\./,
  );
});
