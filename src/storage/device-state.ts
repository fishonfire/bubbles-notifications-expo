import { File, Paths } from 'expo-file-system';
import { failWithBubblesError } from '../internal/errors';
import { isPlainObject } from '../internal/validation';

const STORED_DEVICE_STATE_FILE_NAME = 'bubbles-notifications-expo-state.json';
const LEGACY_DEVICE_ID_FILE_NAME = 'device-id.txt';
const STORED_DEVICE_STATE_VERSION = 1 as const;

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

function getStoredDeviceStateFile() {
  return new File(Paths.document, STORED_DEVICE_STATE_FILE_NAME);
}

function getLegacyDeviceIdFile() {
  return new File(Paths.document, LEGACY_DEVICE_ID_FILE_NAME);
}

function readLegacyStoredDeviceId(): string | null {
  const legacyDeviceIdFile = getLegacyDeviceIdFile();

  if (!legacyDeviceIdFile.exists) {
    return null;
  }

  const storedDeviceId = legacyDeviceIdFile.textSync().trim();
  return storedDeviceId.length > 0 ? storedDeviceId : null;
}

function normalizeStoredDeviceState(
  value: unknown,
  sourceDescription: string,
): StoredDeviceState {
  if (!isPlainObject(value)) {
    failWithBubblesError(
      `Stored device state in ${sourceDescription} must be a JSON object.`,
    );
  }

  if (value.version !== STORED_DEVICE_STATE_VERSION) {
    failWithBubblesError(
      `Stored device state in ${sourceDescription} uses unsupported schema version "${String(
        value.version,
      )}".`,
    );
  }

  return {
    deviceId: getOptionalNonEmptyString(value.deviceId, 'deviceId'),
    apiBaseUrl: getOptionalNonEmptyString(value.apiBaseUrl, 'apiBaseUrl'),
    appKey: getOptionalNonEmptyString(value.appKey, 'appKey'),
  };
}

function normalizeStoredDeviceStateInput(
  value: unknown,
): StoredDeviceState {
  if (!isPlainObject(value)) {
    failWithBubblesError('Stored device state must be an object.');
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

function readStoredDeviceStateFileText(): string | null {
  const storedDeviceStateFile = getStoredDeviceStateFile();

  if (!storedDeviceStateFile.exists) {
    return null;
  }

  const contents = storedDeviceStateFile.textSync().trim();
  return contents.length > 0 ? contents : null;
}

function ensureStoredDeviceStateFile() {
  const storedDeviceStateFile = getStoredDeviceStateFile();

  if (!storedDeviceStateFile.exists) {
    storedDeviceStateFile.create({ intermediates: true });
  }

  return storedDeviceStateFile;
}

function withLegacyDeviceIdFallback(
  state: StoredDeviceState,
): StoredDeviceState {
  if (state.deviceId) {
    return state;
  }

  const legacyDeviceId = readLegacyStoredDeviceId();

  if (!legacyDeviceId) {
    return state;
  }

  return {
    ...state,
    deviceId: legacyDeviceId,
  };
}

export function readStoredDeviceState(): StoredDeviceState {
  const storedDeviceStateFile = getStoredDeviceStateFile();
  const rawState = readStoredDeviceStateFileText();

  if (rawState === null) {
    return withLegacyDeviceIdFallback({
      deviceId: null,
      apiBaseUrl: null,
      appKey: null,
    });
  }

  let parsedState: unknown;

  try {
    parsedState = JSON.parse(rawState);
  } catch {
    failWithBubblesError(
      `Stored device state at "${storedDeviceStateFile.uri}" is not valid JSON.`,
    );
  }

  return withLegacyDeviceIdFallback(
    normalizeStoredDeviceState(parsedState, `"${storedDeviceStateFile.uri}"`),
  );
}

export function storeDeviceState(
  state: StoredDeviceState,
): StoredDeviceState {
  const normalizedState = normalizeStoredDeviceStateInput(state);
  const storedDeviceStateFile = ensureStoredDeviceStateFile();

  storedDeviceStateFile.write(
    JSON.stringify(serializeStoredDeviceState(normalizedState), null, 2),
  );

  return normalizedState;
}

export function patchStoredDeviceState(
  update: StoredDeviceStateUpdate,
): StoredDeviceState {
  const normalizedUpdate = normalizeStoredDeviceStateUpdate(update);

  return storeDeviceState({
    ...readStoredDeviceState(),
    ...normalizedUpdate,
  });
}

export function readStoredDeviceId(): string | null {
  return readStoredDeviceState().deviceId;
}

export function readStoredApiBaseUrl(): string | null {
  return readStoredDeviceState().apiBaseUrl;
}

export function readStoredAppKey(): string | null {
  return readStoredDeviceState().appKey;
}

export function storeDeviceId(deviceId: string | null): StoredDeviceState {
  return patchStoredDeviceState({ deviceId });
}

export function storeApiBaseUrl(
  apiBaseUrl: string | null,
): StoredDeviceState {
  return patchStoredDeviceState({ apiBaseUrl });
}

export function storeAppKey(appKey: string | null): StoredDeviceState {
  return patchStoredDeviceState({ appKey });
}
