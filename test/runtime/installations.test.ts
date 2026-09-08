import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const installationCalls = {
  getInstallations: 0,
  getId: 0,
};
const installationState = {
  installationId: 'fid-123' as unknown,
  error: null as unknown,
};
const installationsInstance = { mock: true };

vi.doMock('@react-native-firebase/installations', () => ({
  getInstallations: () => {
    installationCalls.getInstallations += 1;
    return installationsInstance;
  },
  getId: async (instance: unknown) => {
    installationCalls.getId += 1;
    assert.equal(instance, installationsInstance);

    if (installationState.error) {
      throw installationState.error;
    }

    return installationState.installationId;
  },
}));

const { getFirebaseInstallationId } = await import(
  '../../src/runtime/installations.ts'
);

beforeEach(() => {
  installationCalls.getInstallations = 0;
  installationCalls.getId = 0;
  installationState.installationId = 'fid-123';
  installationState.error = null;
});

test('getFirebaseInstallationId resolves and trims the Firebase installation id', async () => {
  installationState.installationId = ' fid-123 ';

  assert.equal(await getFirebaseInstallationId('android'), 'fid-123');
  assert.equal(installationCalls.getInstallations, 1);
  assert.equal(installationCalls.getId, 1);
});

test('Firebase installation id failures include the iOS setup hint', async () => {
  installationState.error = new Error('installations misconfigured');

  await assert.rejects(
    () => getFirebaseInstallationId('ios'),
    /expo\.ios\.googleServicesFile/,
  );
  await assert.rejects(
    () => getFirebaseInstallationId('ios'),
    /installations misconfigured/,
  );
});

test('empty Firebase installation ids are rejected with a source-specific error', async () => {
  installationState.installationId = '   ';

  await assert.rejects(
    () => getFirebaseInstallationId('android'),
    /android Firebase installation id from Firebase Installations must not be empty\./,
  );
});
