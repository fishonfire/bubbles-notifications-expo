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
  assert.deepEqual(installationCalls, []);
});

test('getDeviceRegistrationState returns the Firebase installation id as the registration token', async () => {
  const result = await getDeviceRegistrationState();

  assert.deepEqual(installationCalls, ['android']);
  assert.deepEqual(result, {
    platform: 'android',
    tokenType: 'fid',
    token: 'fid-123',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
  assert.equal(await getFCMToken(), 'fid-123');
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

test('Firebase installation id failures include the iOS setup hint', async () => {
  platform.OS = 'ios';
  installationState.error = new Error('installations misconfigured');

  await assert.rejects(
    () => getDeviceRegistrationState(),
    /expo\.ios\.googleServicesFile/,
  );
  await assert.rejects(
    () => getDeviceRegistrationState(),
    /Firebase APNs setup is complete/,
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
