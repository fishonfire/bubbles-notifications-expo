import { File, Paths } from 'expo-file-system';
import { writeAsStringAsync } from 'expo-file-system/legacy';

import type { BubblesDeliveryStatus } from '../api/delivery-status';
import { failWithBubblesError } from '../internal/errors';
import { isPlainObject } from '../internal/validation';

const DELIVERY_STATUS_LEDGER_FILE_NAME =
  'bubbles-notifications-expo-delivery-status-ledger.json';
const DELIVERY_STATUS_LEDGER_VERSION = 1 as const;
const MAX_PENDING_EVENT_COUNT = 200;
const MAX_PENDING_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_POSTED_EVENT_KEYS = 200;
let deliveryStatusLedgerServiceQueue: Promise<unknown> = Promise.resolve();

export interface StoredDeliveryStatusEvent {
  key: string;
  notificationId: string;
  status?: BubblesDeliveryStatus;
  error?: string;
  createdAt: string;
}

export interface StoredDeliveryStatusLedger {
  pendingEvents: StoredDeliveryStatusEvent[];
  postedEventKeys: string[];
}

export interface CreateStoredDeliveryStatusEventOptions {
  notificationId: string;
  status?: BubblesDeliveryStatus;
  error?: string | null;
}

type PersistedDeliveryStatusLedger = {
  version: typeof DELIVERY_STATUS_LEDGER_VERSION;
  pendingEvents?: StoredDeliveryStatusEvent[];
  postedEventKeys?: string[];
};

function getDeliveryStatusLedgerFile() {
  return new File(Paths.document, DELIVERY_STATUS_LEDGER_FILE_NAME);
}

function getOptionalNonEmptyString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function requireString(value: unknown, sourceDescription: string): string {
  if (typeof value !== 'string') {
    failWithBubblesError(`${sourceDescription} must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    failWithBubblesError(`${sourceDescription} must not be empty.`);
  }

  return trimmedValue;
}

export function buildStoredDeliveryStatusEventKey(
  options: Omit<CreateStoredDeliveryStatusEventOptions, 'error'> & {
    error?: string;
  },
): string {
  return JSON.stringify([
    options.notificationId,
    options.status ?? null,
    options.error ?? null,
  ]);
}

export function createStoredDeliveryStatusEvent(
  options: CreateStoredDeliveryStatusEventOptions,
): StoredDeliveryStatusEvent {
  const error = getOptionalNonEmptyString(options.error);

  return {
    key: buildStoredDeliveryStatusEventKey({
      notificationId: options.notificationId,
      status: options.status,
      error,
    }),
    notificationId: options.notificationId,
    ...(options.status ? { status: options.status } : {}),
    ...(error ? { error } : {}),
    createdAt: new Date().toISOString(),
  };
}

function normalizeStoredDeliveryStatusEvent(
  value: unknown,
  sourceDescription: string,
): StoredDeliveryStatusEvent {
  if (!isPlainObject(value)) {
    failWithBubblesError(`${sourceDescription} must be a JSON object.`);
  }

  const status = getOptionalNonEmptyString(value.status) as
    | BubblesDeliveryStatus
    | undefined;
  const error = getOptionalNonEmptyString(value.error);
  const notificationId = requireString(
    value.notificationId,
    `${sourceDescription}.notificationId`,
  );

  return {
    key: buildStoredDeliveryStatusEventKey({
      notificationId,
      status,
      error,
    }),
    notificationId,
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
    createdAt: requireString(value.createdAt, `${sourceDescription}.createdAt`),
  };
}

function normalizeStoredDeliveryStatusEventKey(value: unknown): string | null {
  const key = getOptionalNonEmptyString(value);

  if (!key) {
    return null;
  }

  try {
    const keyParts: unknown = JSON.parse(key);

    if (Array.isArray(keyParts) && keyParts.length === 4) {
      return JSON.stringify(keyParts.slice(0, 3));
    }
  } catch {
    return key;
  }

  return key;
}

function normalizeStoredDeliveryStatusEventKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map(normalizeStoredDeliveryStatusEventKey)
        .filter((item): item is string => item !== null),
    ),
  );
}

function boundPendingEvents(
  pendingEvents: StoredDeliveryStatusEvent[],
  now = Date.now(),
): StoredDeliveryStatusEvent[] {
  // Retain the newest 200 events for at most seven days.
  const oldestAllowedTimestamp = now - MAX_PENDING_EVENT_AGE_MS;

  const boundedEvents = pendingEvents
    .filter((event) => {
      const createdAtTimestamp = Date.parse(event.createdAt);

      return (
        Number.isFinite(createdAtTimestamp) &&
        createdAtTimestamp >= oldestAllowedTimestamp
      );
    })
    .slice(-MAX_PENDING_EVENT_COUNT);

  const seenEventKeys = new Set<string>();

  return boundedEvents.filter((event) => {
    if (seenEventKeys.has(event.key)) {
      return false;
    }

    seenEventKeys.add(event.key);
    return true;
  });
}

function normalizeDeliveryStatusLedger(
  value: unknown,
  sourceDescription: string,
): StoredDeliveryStatusLedger {
  if (!isPlainObject(value)) {
    failWithBubblesError(
      `Stored delivery status ledger in ${sourceDescription} must be a JSON object.`,
    );
  }

  if (value.version !== DELIVERY_STATUS_LEDGER_VERSION) {
    failWithBubblesError(
      `Stored delivery status ledger in ${sourceDescription} uses unsupported schema version "${String(
        value.version,
      )}".`,
    );
  }

  return {
    pendingEvents: boundPendingEvents(
      Array.isArray(value.pendingEvents)
        ? value.pendingEvents.map((event, index) =>
            normalizeStoredDeliveryStatusEvent(
              event,
              `${sourceDescription}.pendingEvents[${index}]`,
            ),
          )
        : [],
    ),
    postedEventKeys: normalizeStoredDeliveryStatusEventKeys(
      value.postedEventKeys,
    ).slice(-MAX_POSTED_EVENT_KEYS),
  };
}

function serializeDeliveryStatusLedger(
  ledger: StoredDeliveryStatusLedger,
): PersistedDeliveryStatusLedger {
  return {
    version: DELIVERY_STATUS_LEDGER_VERSION,
    pendingEvents: boundPendingEvents(ledger.pendingEvents),
    postedEventKeys: ledger.postedEventKeys.slice(-MAX_POSTED_EVENT_KEYS),
  };
}

function readDeliveryStatusLedgerFileText(): string | null {
  const ledgerFile = getDeliveryStatusLedgerFile();

  if (!ledgerFile.exists) {
    return null;
  }

  const contents = ledgerFile.textSync().trim();
  return contents.length > 0 ? contents : null;
}

async function readDeliveryStatusLedgerFileTextAsync(): Promise<string | null> {
  const ledgerFile = getDeliveryStatusLedgerFile();

  if (!ledgerFile.exists) {
    return null;
  }

  const contents = (await ledgerFile.text()).trim();
  return contents.length > 0 ? contents : null;
}

function ensureDeliveryStatusLedgerFile() {
  const ledgerFile = getDeliveryStatusLedgerFile();

  if (!ledgerFile.exists) {
    ledgerFile.create({ intermediates: true });
  }

  return ledgerFile;
}

export function runDeliveryStatusLedgerServiceOperation<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  const queuedOperation = deliveryStatusLedgerServiceQueue.then(operation);

  deliveryStatusLedgerServiceQueue = queuedOperation.catch(() => undefined);

  return queuedOperation;
}

export function readStoredDeliveryStatusLedger(): StoredDeliveryStatusLedger {
  const ledgerFile = getDeliveryStatusLedgerFile();
  const rawLedger = readDeliveryStatusLedgerFileText();

  if (rawLedger === null) {
    return {
      pendingEvents: [],
      postedEventKeys: [],
    };
  }

  let parsedLedger: unknown;

  try {
    parsedLedger = JSON.parse(rawLedger);
  } catch {
    failWithBubblesError(
      `Stored delivery status ledger at "${ledgerFile.uri}" is not valid JSON.`,
    );
  }

  return normalizeDeliveryStatusLedger(
    parsedLedger,
    `"${ledgerFile.uri}"`,
  );
}

export async function readStoredDeliveryStatusLedgerAsync(): Promise<StoredDeliveryStatusLedger> {
  const ledgerFile = getDeliveryStatusLedgerFile();
  const rawLedger = await readDeliveryStatusLedgerFileTextAsync();

  if (rawLedger === null) {
    return {
      pendingEvents: [],
      postedEventKeys: [],
    };
  }

  let parsedLedger: unknown;

  try {
    parsedLedger = JSON.parse(rawLedger);
  } catch {
    failWithBubblesError(
      `Stored delivery status ledger at "${ledgerFile.uri}" is not valid JSON.`,
    );
  }

  return normalizeDeliveryStatusLedger(
    parsedLedger,
    `"${ledgerFile.uri}"`,
  );
}

export function storeDeliveryStatusLedger(
  ledger: StoredDeliveryStatusLedger,
): StoredDeliveryStatusLedger {
  const normalizedLedger: StoredDeliveryStatusLedger = {
    pendingEvents: boundPendingEvents(ledger.pendingEvents),
    postedEventKeys: ledger.postedEventKeys.slice(-MAX_POSTED_EVENT_KEYS),
  };
  const ledgerFile = ensureDeliveryStatusLedgerFile();

  ledgerFile.write(
    JSON.stringify(serializeDeliveryStatusLedger(normalizedLedger), null, 2),
  );

  return normalizedLedger;
}

export async function storeDeliveryStatusLedgerAsync(
  ledger: StoredDeliveryStatusLedger,
): Promise<StoredDeliveryStatusLedger> {
  const normalizedLedger: StoredDeliveryStatusLedger = {
    pendingEvents: boundPendingEvents(ledger.pendingEvents),
    postedEventKeys: ledger.postedEventKeys.slice(-MAX_POSTED_EVENT_KEYS),
  };
  const ledgerFile = getDeliveryStatusLedgerFile();

  await writeAsStringAsync(
    ledgerFile.uri,
    JSON.stringify(serializeDeliveryStatusLedger(normalizedLedger), null, 2),
  );

  return normalizedLedger;
}

export function enqueueStoredDeliveryStatusEvent(
  event: StoredDeliveryStatusEvent,
): StoredDeliveryStatusLedger {
  const ledger = readStoredDeliveryStatusLedger();

  if (
    ledger.postedEventKeys.includes(event.key) ||
    ledger.pendingEvents.some((pendingEvent) => pendingEvent.key === event.key)
  ) {
    return ledger;
  }

  return storeDeliveryStatusLedger({
    ...ledger,
    pendingEvents: [...ledger.pendingEvents, event],
  });
}

export function enqueueStoredDeliveryStatusEventAsync(
  event: StoredDeliveryStatusEvent,
): Promise<StoredDeliveryStatusLedger> {
  return runDeliveryStatusLedgerServiceOperation(async () => {
    const ledger = await readStoredDeliveryStatusLedgerAsync();

    if (
      ledger.postedEventKeys.includes(event.key) ||
      ledger.pendingEvents.some(
        (pendingEvent) => pendingEvent.key === event.key,
      )
    ) {
      return ledger;
    }

    return storeDeliveryStatusLedgerAsync({
      ...ledger,
      pendingEvents: [...ledger.pendingEvents, event],
    });
  });
}

export function markStoredDeliveryStatusEventPosted(
  event: StoredDeliveryStatusEvent,
): StoredDeliveryStatusLedger {
  const ledger = readStoredDeliveryStatusLedger();
  const postedEventKeys = ledger.postedEventKeys.includes(event.key)
    ? ledger.postedEventKeys
    : [...ledger.postedEventKeys, event.key];

  return storeDeliveryStatusLedger({
    pendingEvents: ledger.pendingEvents.filter(
      (pendingEvent) => pendingEvent.key !== event.key,
    ),
    postedEventKeys,
  });
}

export function markStoredDeliveryStatusEventPostedAsync(
  event: StoredDeliveryStatusEvent,
): Promise<StoredDeliveryStatusLedger> {
  return runDeliveryStatusLedgerServiceOperation(async () => {
    const ledger = await readStoredDeliveryStatusLedgerAsync();
    const postedEventKeys = ledger.postedEventKeys.includes(event.key)
      ? ledger.postedEventKeys
      : [...ledger.postedEventKeys, event.key];

    return storeDeliveryStatusLedgerAsync({
      pendingEvents: ledger.pendingEvents.filter(
        (pendingEvent) => pendingEvent.key !== event.key,
      ),
      postedEventKeys,
    });
  });
}
