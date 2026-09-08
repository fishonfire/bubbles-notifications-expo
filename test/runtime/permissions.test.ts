import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const platformState = {
  OS: 'ios',
};
type MockPermissionStatus = {
  granted: boolean;
  status: string;
  ios?: {
    status: number;
  };
};

const permissionState = {
  existing: {
    granted: false,
    status: 'denied',
    ios: {
      status: 1,
    },
  } as MockPermissionStatus,
  requestResult: {
    granted: true,
    status: 'granted',
    ios: {
      status: 2,
    },
  } as MockPermissionStatus,
};
const notificationCalls = {
  getPermissions: 0,
  requestPermissions: [] as Array<Record<string, unknown> | undefined>,
};
let ensureChannelCallCount = 0;

const IOS_AUTHORIZATION_STATUS = {
  0: 'NOT_DETERMINED',
  1: 'DENIED',
  2: 'AUTHORIZED',
  3: 'PROVISIONAL',
  4: 'EPHEMERAL',
  NOT_DETERMINED: 0,
  DENIED: 1,
  AUTHORIZED: 2,
  PROVISIONAL: 3,
  EPHEMERAL: 4,
} as const;

vi.doMock('expo-notifications', () => ({
  IosAuthorizationStatus: IOS_AUTHORIZATION_STATUS,
  getPermissionsAsync: async () => {
    notificationCalls.getPermissions += 1;
    return permissionState.existing;
  },
  requestPermissionsAsync: async (
    options?: Record<string, unknown>,
  ) => {
    notificationCalls.requestPermissions.push(options);
    return permissionState.requestResult;
  },
}));

vi.doMock('react-native', () => ({
  Platform: platformState,
}));

vi.doMock('../../src/runtime/channels.ts', () => ({
  ensureDefaultNotificationChannel: async () => {
    ensureChannelCallCount += 1;
    return null;
  },
}));

const {
  describeNotificationPermissionStatus,
  ensureNotificationPermissions,
  getNotificationPermissions,
  isNotificationPermissionGranted,
} = await import('../../src/runtime/permissions.ts');

beforeEach(() => {
  platformState.OS = 'ios';
  permissionState.existing = {
    granted: false,
    status: 'denied',
    ios: {
      status: IOS_AUTHORIZATION_STATUS.DENIED,
    },
  };
  permissionState.requestResult = {
    granted: true,
    status: 'granted',
    ios: {
      status: IOS_AUTHORIZATION_STATUS.AUTHORIZED,
    },
  };
  notificationCalls.getPermissions = 0;
  notificationCalls.requestPermissions.length = 0;
  ensureChannelCallCount = 0;
});

test('isNotificationPermissionGranted honors the iOS authorization status instead of the top-level granted flag', () => {
  assert.equal(
    isNotificationPermissionGranted({
      granted: false,
      status: 'denied',
      ios: {
        status: IOS_AUTHORIZATION_STATUS.AUTHORIZED,
      },
    } as never),
    true,
  );
  assert.equal(
    isNotificationPermissionGranted({
      granted: false,
      status: 'denied',
      ios: {
        status: IOS_AUTHORIZATION_STATUS.PROVISIONAL,
      },
    } as never),
    true,
  );
  assert.equal(
    isNotificationPermissionGranted({
      granted: false,
      status: 'denied',
      ios: {
        status: IOS_AUTHORIZATION_STATUS.EPHEMERAL,
      },
    } as never),
    true,
  );
  assert.equal(
    isNotificationPermissionGranted({
      granted: false,
      status: 'denied',
      ios: {
        status: IOS_AUTHORIZATION_STATUS.DENIED,
      },
    } as never),
    false,
  );
});

test('describeNotificationPermissionStatus lowercases the iOS authorization enum key', () => {
  const description = describeNotificationPermissionStatus({
    granted: false,
    status: 'denied',
    ios: {
      status: IOS_AUTHORIZATION_STATUS.PROVISIONAL,
    },
  } as never);

  assert.equal(description, 'provisional');
});

test('getNotificationPermissions ensures the Android channel and returns existing granted permissions without prompting', async () => {
  platformState.OS = 'android';
  permissionState.existing = {
    granted: true,
    status: 'granted',
  };

  const result = await getNotificationPermissions();

  assert.equal(ensureChannelCallCount, 1);
  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(notificationCalls.requestPermissions, []);
  assert.deepEqual(result, {
    granted: true,
    status: 'granted',
  });
});

test('getNotificationPermissions skips prompting when requestPermissions is false', async () => {
  const result = await getNotificationPermissions({
    requestPermissions: false,
  });

  assert.equal(ensureChannelCallCount, 1);
  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(notificationCalls.requestPermissions, []);
  assert.deepEqual(result, permissionState.existing);
});

test('getNotificationPermissions forwards the permission request options when prompting is needed', async () => {
  permissionState.requestResult = {
    granted: true,
    status: 'granted',
    ios: {
      status: IOS_AUTHORIZATION_STATUS.AUTHORIZED,
    },
  };

  const result = await getNotificationPermissions({
    permissionRequestOptions: {
      ios: {
        allowAlert: true,
      },
    },
  });

  assert.equal(ensureChannelCallCount, 1);
  assert.equal(notificationCalls.getPermissions, 1);
  assert.deepEqual(notificationCalls.requestPermissions, [
    {
      ios: {
        allowAlert: true,
      },
    },
  ]);
  assert.deepEqual(result, permissionState.requestResult);
});

test('ensureNotificationPermissions throws with the current error text when permission remains denied', async () => {
  permissionState.requestResult = {
    granted: false,
    status: 'denied',
    ios: {
      status: IOS_AUTHORIZATION_STATUS.DENIED,
    },
  };

  await assert.rejects(
    () => ensureNotificationPermissions(),
    /Push notification permission was not granted\./,
  );
});

test('getNotificationPermissions rejects unsupported platforms before querying Expo permissions', async () => {
  platformState.OS = 'web';

  await assert.rejects(
    () => getNotificationPermissions(),
    /Unsupported platform: web\. This package only supports iOS and Android\./,
  );

  assert.equal(ensureChannelCallCount, 0);
  assert.equal(notificationCalls.getPermissions, 0);
});
