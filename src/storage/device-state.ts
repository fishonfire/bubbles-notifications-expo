import { File, Paths } from 'expo-file-system';
import { failWithBubblesError } from '../internal/errors';
import { isPlainObject } from '../internal/validation';

const STORED_DEVICE_STATE_FILE_NAME = 'bubbles-notifications-expo-state.json';
const LEGACY_DEVICE_ID_FILE_NAME = 'device-id.txt';
const STORED_DEVICE_STATE_VERSION = 1 as const;
const EMPTY_STORED_DEVICE_STATE: StoredDeviceState = {
  deviceId: null,
  apiBaseUrl: null,
  appKey: null,
};

export interface StoredDeviceState {
  deviceId: string | null;
  apiBaseUrl: string | null;
  appKey: string | null;
}

export type StoredDeviceStateUpdate = Partial<StoredDeviceState>;

type PersistedStoredDeviceState = {
  version: typeof STORED_DEVICE_STATE_VERSION;
  deviceId?: string;
  apiBaseUrl?: string;
  appKey?: string;
};

type StoredDeviceStateUpdater = (
  state: StoredDeviceState,
) => StoredDeviceState | Promise<StoredDeviceState>;

let mutationQueue: Promise<void> = Promise.resolve();
let temporaryFileSequence = 0;

function getOptionalNonEmptyString(
  value: unknown,
  fieldName: keyof StoredDeviceState,
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    failWithBubblesError(`Stored "${fieldName}" must be a string when present.`);
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeStoredDeviceState(
  value: unknown,
  sourceDescription = 'storage',
): StoredDeviceState {
  if (!isPlainObject(value)) {
    failWithBubblesError(
      `Stored device state in ${sourceDescription} must be a JSON object.`,
    );
  }

  return {
    deviceId: getOptionalNonEmptyString(value.deviceId, 'deviceId'),
    apiBaseUrl: getOptionalNonEmptyString(value.apiBaseUrl, 'apiBaseUrl'),
    appKey: getOptionalNonEmptyString(value.appKey, 'appKey'),
  };
}

function normalizeStoredDeviceStateUpdate(
  value: unknown,
): StoredDeviceStateUpdate {
  if (!isPlainObject(value)) {
    failWithBubblesError('Stored device state update must be an object.');
  }

  const nextState: StoredDeviceStateUpdate = {};

  if ('deviceId' in value) {
    nextState.deviceId = getOptionalNonEmptyString(value.deviceId, 'deviceId');
  }

  if ('apiBaseUrl' in value) {
    nextState.apiBaseUrl = getOptionalNonEmptyString(
      value.apiBaseUrl,
      'apiBaseUrl',
    );
  }

  if ('appKey' in value) {
    nextState.appKey = getOptionalNonEmptyString(value.appKey, 'appKey');
  }

  return nextState;
}

function serializeStoredDeviceState(
  state: StoredDeviceState,
): PersistedStoredDeviceState {
  const serializedState: PersistedStoredDeviceState = {
    version: STORED_DEVICE_STATE_VERSION,
  };

  if (state.deviceId) {
    serializedState.deviceId = state.deviceId;
  }

  if (state.apiBaseUrl) {
    serializedState.apiBaseUrl = state.apiBaseUrl;
  }

  if (state.appKey) {
    serializedState.appKey = state.appKey;
  }

  return serializedState;
}

function getStoredDeviceStateFile() {
  return new File(Paths.document, STORED_DEVICE_STATE_FILE_NAME);
}

function getLegacyDeviceIdFile() {
  return new File(Paths.document, LEGACY_DEVICE_ID_FILE_NAME);
}

function getTemporaryStoredDeviceStateFile() {
  temporaryFileSequence += 1;
  return new File(
    Paths.document,
    `${STORED_DEVICE_STATE_FILE_NAME}.tmp-${Date.now()}-${temporaryFileSequence}`,
  );
}

function getCorruptStoredDeviceStateFile() {
  return new File(
    Paths.document,
    `${STORED_DEVICE_STATE_FILE_NAME}.corrupt-${Date.now()}`,
  );
}

function parseStoredDeviceState(rawState: string, uri: string) {
  const parsedState: unknown = JSON.parse(rawState);

  if (!isPlainObject(parsedState)) {
    failWithBubblesError(
      `Stored device state in "${uri}" must be a JSON object.`,
    );
  }

  if (parsedState.version !== STORED_DEVICE_STATE_VERSION) {
    failWithBubblesError(
      `Stored device state in "${uri}" uses unsupported schema version "${String(
        parsedState.version,
      )}".`,
    );
  }

  return normalizeStoredDeviceState(parsedState, `"${uri}"`);
}

function deleteFileIfPresent(file: File) {
  if (file.exists) {
    file.delete();
  }
}

function deleteLegacyDeviceIdFile() {
  try {
    deleteFileIfPresent(getLegacyDeviceIdFile());
  } catch {
    return;
  }
}

function readLegacyStoredDeviceIdSync(): string | null {
  const legacyDeviceIdFile = getLegacyDeviceIdFile();

  if (!legacyDeviceIdFile.exists) {
    return null;
  }

  const storedDeviceId = legacyDeviceIdFile.textSync().trim();
  return storedDeviceId.length > 0 ? storedDeviceId : null;
}

async function readLegacyStoredDeviceId(): Promise<string | null> {
  const legacyDeviceIdFile = getLegacyDeviceIdFile();

  if (!legacyDeviceIdFile.exists) {
    return null;
  }

  const storedDeviceId = (await legacyDeviceIdFile.text()).trim();
  return storedDeviceId.length > 0 ? storedDeviceId : null;
}

function writeStateSync(state: StoredDeviceState) {
  const destination = getStoredDeviceStateFile();
  const temporaryFile = getTemporaryStoredDeviceStateFile();
  let replacementSucceeded = false;

  try {
    temporaryFile.write(
      JSON.stringify(serializeStoredDeviceState(state), null, 2),
    );
    temporaryFile.moveSync(destination, { overwrite: true });
    replacementSucceeded = true;
  } finally {
    if (!replacementSucceeded) {
      deleteFileIfPresent(temporaryFile);
    }
  }
}

async function writeState(state: StoredDeviceState) {
  const destination = getStoredDeviceStateFile();
  const temporaryFile = getTemporaryStoredDeviceStateFile();
  let replacementSucceeded = false;

  try {
    temporaryFile.write(
      JSON.stringify(serializeStoredDeviceState(state), null, 2),
    );
    await temporaryFile.move(destination, { overwrite: true });
    replacementSucceeded = true;
  } finally {
    if (!replacementSucceeded) {
      deleteFileIfPresent(temporaryFile);
    }
  }
}

function recoverCorruptStateSync(storedDeviceStateFile: File) {
  const corruptStateFile = getCorruptStoredDeviceStateFile();

  try {
    storedDeviceStateFile.moveSync(corruptStateFile, { overwrite: true });
  } catch {
    deleteFileIfPresent(storedDeviceStateFile);
  }

  writeStateSync(EMPTY_STORED_DEVICE_STATE);
  deleteLegacyDeviceIdFile();
  return { ...EMPTY_STORED_DEVICE_STATE };
}

async function recoverCorruptState(storedDeviceStateFile: File) {
  const corruptStateFile = getCorruptStoredDeviceStateFile();

  try {
    await storedDeviceStateFile.move(corruptStateFile, { overwrite: true });
  } catch {
    deleteFileIfPresent(storedDeviceStateFile);
  }

  await writeState(EMPTY_STORED_DEVICE_STATE);
  deleteLegacyDeviceIdFile();
  return { ...EMPTY_STORED_DEVICE_STATE };
}

function readStateSync(): StoredDeviceState {
  const storedDeviceStateFile = getStoredDeviceStateFile();

  if (storedDeviceStateFile.exists) {
    const rawState = storedDeviceStateFile.textSync().trim();

    try {
      const state = parseStoredDeviceState(rawState, storedDeviceStateFile.uri);
      deleteLegacyDeviceIdFile();
      return state;
    } catch {
      return recoverCorruptStateSync(storedDeviceStateFile);
    }
  }

  const state = {
    ...EMPTY_STORED_DEVICE_STATE,
    deviceId: readLegacyStoredDeviceIdSync(),
  };
  writeStateSync(state);
  deleteLegacyDeviceIdFile();
  return state;
}

async function readState(): Promise<StoredDeviceState> {
  const storedDeviceStateFile = getStoredDeviceStateFile();

  if (storedDeviceStateFile.exists) {
    const rawState = (await storedDeviceStateFile.text()).trim();

    try {
      const state = parseStoredDeviceState(rawState, storedDeviceStateFile.uri);
      deleteLegacyDeviceIdFile();
      return state;
    } catch {
      return recoverCorruptState(storedDeviceStateFile);
    }
  }

  const state = {
    ...EMPTY_STORED_DEVICE_STATE,
    deviceId: await readLegacyStoredDeviceId(),
  };
  await writeState(state);
  deleteLegacyDeviceIdFile();
  return state;
}

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function updateState(
  updater: StoredDeviceStateUpdater,
): Promise<StoredDeviceState> {
  return runSerialized(async () => {
    const nextState = normalizeStoredDeviceState(await updater(await readState()));
    await writeState(nextState);
    return nextState;
  });
}

/** @deprecated Use readStoredDeviceStateAsync. */
export function readStoredDeviceState(): StoredDeviceState {
  return readStateSync();
}

export async function readStoredDeviceStateAsync(): Promise<StoredDeviceState> {
  return runSerialized(readState);
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export function storeDeviceState(state: StoredDeviceState): StoredDeviceState {
  const normalizedState = normalizeStoredDeviceState(state);
  writeStateSync(normalizedState);
  deleteLegacyDeviceIdFile();
  return normalizedState;
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export async function storeDeviceStateAsync(
  state: StoredDeviceState,
): Promise<StoredDeviceState> {
  const normalizedState = normalizeStoredDeviceState(state);
  return updateState(() => normalizedState);
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export function patchStoredDeviceState(
  update: StoredDeviceStateUpdate,
): StoredDeviceState {
  const nextState = {
    ...readStateSync(),
    ...normalizeStoredDeviceStateUpdate(update),
  };
  writeStateSync(nextState);
  return nextState;
}

export async function patchStoredDeviceStateAsync(
  update: StoredDeviceStateUpdate,
): Promise<StoredDeviceState> {
  const normalizedUpdate = normalizeStoredDeviceStateUpdate(update);
  return updateState((state) => ({ ...state, ...normalizedUpdate }));
}

/** @deprecated Use readStoredDeviceStateAsync. */
export function readStoredDeviceId(): string | null {
  return readStoredDeviceState().deviceId;
}

/** @deprecated Use readStoredDeviceStateAsync. */
export async function readStoredDeviceIdAsync(): Promise<string | null> {
  return (await readStoredDeviceStateAsync()).deviceId;
}

/** @deprecated Use readStoredDeviceStateAsync. */
export function readStoredApiBaseUrl(): string | null {
  return readStoredDeviceState().apiBaseUrl;
}

/** @deprecated Use readStoredDeviceStateAsync. */
export async function readStoredApiBaseUrlAsync(): Promise<string | null> {
  return (await readStoredDeviceStateAsync()).apiBaseUrl;
}

/** @deprecated Use readStoredDeviceStateAsync. */
export function readStoredAppKey(): string | null {
  return readStoredDeviceState().appKey;
}

/** @deprecated Use readStoredDeviceStateAsync. */
export async function readStoredAppKeyAsync(): Promise<string | null> {
  return (await readStoredDeviceStateAsync()).appKey;
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export function storeDeviceId(deviceId: string | null): StoredDeviceState {
  return patchStoredDeviceState({ deviceId });
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export async function storeDeviceIdAsync(
  deviceId: string | null,
): Promise<StoredDeviceState> {
  return patchStoredDeviceStateAsync({ deviceId });
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export function storeApiBaseUrl(
  apiBaseUrl: string | null,
): StoredDeviceState {
  return patchStoredDeviceState({ apiBaseUrl });
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export async function storeApiBaseUrlAsync(
  apiBaseUrl: string | null,
): Promise<StoredDeviceState> {
  return patchStoredDeviceStateAsync({ apiBaseUrl });
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export function storeAppKey(appKey: string | null): StoredDeviceState {
  return patchStoredDeviceState({ appKey });
}

/** @deprecated Use patchStoredDeviceStateAsync. */
export async function storeAppKeyAsync(
  appKey: string | null,
): Promise<StoredDeviceState> {
  return patchStoredDeviceStateAsync({ appKey });
}
