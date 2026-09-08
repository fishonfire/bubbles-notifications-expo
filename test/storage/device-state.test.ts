import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const fileContents = new Map<string, string>();
const documentDirectory = '/mock/document';
const storedStateUri =
  `${documentDirectory}/bubbles-notifications-expo-state.json`;
const legacyDeviceIdUri = `${documentDirectory}/device-id.txt`;

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

vi.doMock('expo-file-system', () => ({
  File: MockFile,
  Paths: {
    document: documentDirectory,
  },
}));

const {
  patchStoredDeviceState,
  readStoredApiBaseUrl,
  readStoredAppKey,
  readStoredDeviceId,
  readStoredDeviceState,
  storeApiBaseUrl,
  storeAppKey,
  storeDeviceId,
  storeDeviceState,
} = await import('../../src/storage/device-state.ts');

beforeEach(() => {
  fileContents.clear();
});

test('reads an empty device state when no package-owned state exists', () => {
  assert.deepEqual(readStoredDeviceState(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null,
  });
  assert.equal(readStoredDeviceId(), null);
  assert.equal(readStoredApiBaseUrl(), null);
  assert.equal(readStoredAppKey(), null);
});

test('stores and patches structured device state', () => {
  const storedState = storeDeviceState({
    deviceId: ' device-1 ',
    apiBaseUrl: ' https://api.example.com ',
    appKey: ' app-key-1 ',
  });

  assert.deepEqual(storedState, {
    deviceId: 'device-1',
    apiBaseUrl: 'https://api.example.com',
    appKey: 'app-key-1',
  });
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify(
      {
        version: 1,
        deviceId: 'device-1',
        apiBaseUrl: 'https://api.example.com',
        appKey: 'app-key-1',
      },
      null,
      2,
    ),
  );

  const patchedState = patchStoredDeviceState({
    apiBaseUrl: ' https://api.staging.example.com ',
  });

  assert.deepEqual(patchedState, {
    deviceId: 'device-1',
    apiBaseUrl: 'https://api.staging.example.com',
    appKey: 'app-key-1',
  });
  assert.deepEqual(readStoredDeviceState(), patchedState);

  storeDeviceId(' device-2 ');
  assert.equal(readStoredDeviceId(), 'device-2');

  storeApiBaseUrl(' https://api.production.example.com ');
  assert.equal(readStoredApiBaseUrl(), 'https://api.production.example.com');

  storeAppKey(' app-key-2 ');
  assert.equal(readStoredAppKey(), 'app-key-2');
});

test('falls back to the legacy device-id file when structured state is missing', () => {
  fileContents.set(legacyDeviceIdUri, ' legacy-device-id ');

  assert.deepEqual(readStoredDeviceState(), {
    deviceId: 'legacy-device-id',
    apiBaseUrl: null,
    appKey: null,
  });
});

test('throws for malformed stored state JSON', () => {
  fileContents.set(storedStateUri, '{this is not valid json');

  assert.throws(
    () => readStoredDeviceState(),
    /Stored device state at "\/mock\/document\/bubbles-notifications-expo-state\.json" is not valid JSON\./,
  );
});
