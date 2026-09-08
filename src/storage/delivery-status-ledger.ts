import { File, Paths } from 'expo-file-system';

import type { BubblesDeliveryStatus } from '../api/delivery-status';
import { failWithBubblesError } from '../internal/errors';
import { isPlainObject } from '../internal/validation';

const DELIVERY_STATUS_LEDGER_FILE_NAME =
  'bubbles-notifications-expo-delivery-status-ledger.json';
const DELIVERY_STATUS_LEDGER_VERSION = 1 as const;
const MAX_POSTED_EVENT_KEYS = 200;

export interface StoredDeliveryStatusEvent {
  key: string;
  notificationId: string;
  status?: BubblesDeliveryStatus;
  error?: string;
  actionId?: string;
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
  actionId?: string | null;
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
    options.actionId ?? null,
  ]);
}

export function createStoredDeliveryStatusEvent(
  options: CreateStoredDeliveryStatusEventOptions,
): StoredDeliveryStatusEvent {
  const error = getOptionalNonEmptyString(options.error);
  const actionId = getOptionalNonEmptyString(options.actionId);

  return {
    key: buildStoredDeliveryStatusEventKey({
      notificationId: options.notificationId,
      status: options.status,
      error,
      actionId,
    }),
    notificationId: options.notificationId,
    ...(options.status ? { status: options.status } : {}),
    ...(error ? { error } : {}),
    ...(actionId ? { actionId } : {}),
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
  const actionId = getOptionalNonEmptyString(value.actionId);

  return {
    key: requireString(value.key, `${sourceDescription}.key`),
    notificationId: requireString(
      value.notificationId,
      `${sourceDescription}.notificationId`,
    ),
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
    ...(actionId ? { actionId } : {}),
    createdAt: requireString(value.createdAt, `${sourceDescription}.createdAt`),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => getOptionalNonEmptyString(item))
    .filter((item): item is string => item !== undefined);
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
    pendingEvents: Array.isArray(value.pendingEvents)
      ? value.pendingEvents.map((event, index) =>
          normalizeStoredDeliveryStatusEvent(
            event,
            `${sourceDescription}.pendingEvents[${index}]`,
          ),
        )
      : [],
    postedEventKeys: normalizeStringArray(value.postedEventKeys).slice(
      -MAX_POSTED_EVENT_KEYS,
    ),
  };
}

function serializeDeliveryStatusLedger(
  ledger: StoredDeliveryStatusLedger,
): PersistedDeliveryStatusLedger {
  return {
    version: DELIVERY_STATUS_LEDGER_VERSION,
    pendingEvents: ledger.pendingEvents,
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

function ensureDeliveryStatusLedgerFile() {
  const ledgerFile = getDeliveryStatusLedgerFile();

  if (!ledgerFile.exists) {
    ledgerFile.create({ intermediates: true });
  }

  return ledgerFile;
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

export function storeDeliveryStatusLedger(
  ledger: StoredDeliveryStatusLedger,
): StoredDeliveryStatusLedger {
  const normalizedLedger: StoredDeliveryStatusLedger = {
    pendingEvents: ledger.pendingEvents,
    postedEventKeys: ledger.postedEventKeys.slice(-MAX_POSTED_EVENT_KEYS),
  };
  const ledgerFile = ensureDeliveryStatusLedgerFile();

  ledgerFile.write(
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
