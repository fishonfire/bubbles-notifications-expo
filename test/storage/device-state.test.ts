import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const fileContents = new Map<string, string>();
const fileMoves: Array<{ from: string; to: string; overwrite: boolean }> = [];
const documentDirectory = '/mock/document';
const storedStateUri =
  `${documentDirectory}/bubbles-notifications-expo-state.json`;
const legacyDeviceIdUri = `${documentDirectory}/device-id.txt`;

class MockFile {
  uri: string;

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

  delete() {
    if (!fileContents.delete(this.uri)) {
      throw new Error(`Missing file: ${this.uri}`);
    }
  }

  moveSync(destination: MockFile, options?: { overwrite?: boolean }) {
    const value = fileContents.get(this.uri);

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`);
    }

    if (fileContents.has(destination.uri) && !options?.overwrite) {
      throw new Error(`Destination exists: ${destination.uri}`);
    }

    fileMoves.push({
      from: this.uri,
      to: destination.uri,
      overwrite: options?.overwrite === true,
    });
    fileContents.set(destination.uri, value);
    fileContents.delete(this.uri);
    this.uri = destination.uri;
  }

  async move(destination: MockFile, options?: { overwrite?: boolean }) {
    this.moveSync(destination, options);
  }
}

vi.doMock('expo-file-system', () => ({
  File: MockFile,
  Paths: {
    document: documentDirectory,
  },
}));

const {
  patchStoredDeviceStateAsync,
  patchStoredDeviceState,
  readStoredApiBaseUrlAsync,
  readStoredApiBaseUrl,
  readStoredAppKeyAsync,
  readStoredAppKey,
  readStoredDeviceIdAsync,
  readStoredDeviceId,
  readStoredDeviceStateAsync,
  readStoredDeviceState,
  storeApiBaseUrlAsync,
  storeApiBaseUrl,
  storeAppKeyAsync,
  storeAppKey,
  storeDeviceIdAsync,
  storeDeviceId,
  storeDeviceStateAsync,
  storeDeviceState,
} = await import('../../src/storage/device-state.ts');

beforeEach(() => {
  fileContents.clear();
  fileMoves.length = 0;
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

test('stores and patches structured device state asynchronously', async () => {
  const storedState = await storeDeviceStateAsync({
    deviceId: ' device-1 ',
    apiBaseUrl: ' https://api.example.com ',
    appKey: ' app-key-1 ',
  });

  assert.deepEqual(storedState, {
    deviceId: 'device-1',
    apiBaseUrl: 'https://api.example.com',
    appKey: 'app-key-1',
  });

  const patchedState = await patchStoredDeviceStateAsync({
    apiBaseUrl: ' https://api.staging.example.com ',
  });

  assert.deepEqual(patchedState, {
    deviceId: 'device-1',
    apiBaseUrl: 'https://api.staging.example.com',
    appKey: 'app-key-1',
  });
  assert.deepEqual(await readStoredDeviceStateAsync(), patchedState);

  await storeDeviceIdAsync(' device-2 ');
  assert.equal(await readStoredDeviceIdAsync(), 'device-2');

  await storeApiBaseUrlAsync(' https://api.production.example.com ');
  assert.equal(
    await readStoredApiBaseUrlAsync(),
    'https://api.production.example.com',
  );

  await storeAppKeyAsync(' app-key-2 ');
  assert.equal(await readStoredAppKeyAsync(), 'app-key-2');
});

test('serializes concurrent updates without losing fields', async () => {
  await Promise.all([
    storeDeviceIdAsync('device-1'),
    storeApiBaseUrlAsync('https://api.example.com'),
    storeAppKeyAsync('app-key-1'),
  ]);

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: 'device-1',
    apiBaseUrl: 'https://api.example.com',
    appKey: 'app-key-1',
  });
});

test('replaces state atomically through a temporary file', async () => {
  await storeDeviceIdAsync('device-1');

  assert.ok(
    fileMoves.some(
      ({ from, to, overwrite }) =>
        from.startsWith(`${storedStateUri}.tmp-`) &&
        to === storedStateUri &&
        overwrite,
    ),
  );
  assert.equal(
    [...fileContents.keys()].some((uri) => uri.includes('.tmp-')),
    false,
  );
});

test('falls back to the legacy device-id file when structured state is missing', () => {
  fileContents.set(legacyDeviceIdUri, ' legacy-device-id ');

  assert.deepEqual(readStoredDeviceState(), {
    deviceId: 'legacy-device-id',
    apiBaseUrl: null,
    appKey: null,
  });
  assert.equal(fileContents.has(legacyDeviceIdUri), false);
  assert.match(fileContents.get(storedStateUri) ?? '', /legacy-device-id/);
});

test('falls back to the legacy device-id file asynchronously when structured state is missing', async () => {
  fileContents.set(legacyDeviceIdUri, ' legacy-device-id ');

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: 'legacy-device-id',
    apiBaseUrl: null,
    appKey: null,
  });
  assert.equal(fileContents.has(legacyDeviceIdUri), false);
});

test('does not resurrect a cleared ID from the legacy file', async () => {
  fileContents.set(legacyDeviceIdUri, 'legacy-device-id');
  await readStoredDeviceStateAsync();
  await storeDeviceIdAsync(null);

  fileContents.set(legacyDeviceIdUri, 'legacy-device-id');

  assert.equal(await readStoredDeviceIdAsync(), null);
  assert.equal(fileContents.has(legacyDeviceIdUri), false);
});

test('quarantines malformed stored state and recovers synchronously', () => {
  fileContents.set(storedStateUri, '{this is not valid json');

  assert.deepEqual(readStoredDeviceState(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null,
  });
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify({ version: 1 }, null, 2),
  );
  assert.ok(
    [...fileContents.keys()].some((uri) => uri.includes('.corrupt-')),
  );
});

test('quarantines malformed stored state and recovers asynchronously', async () => {
  fileContents.set(storedStateUri, '{this is not valid json');

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null,
  });
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify({ version: 1 }, null, 2),
  );
  assert.ok(
    [...fileContents.keys()].some((uri) => uri.includes('.corrupt-')),
  );
});
