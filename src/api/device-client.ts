import {
  DeviceClient,
  type DeviceClientOptions,
  type RequestOptions,
  type UpdateDeviceOptions,
} from '@fishonfire/bubbles-js';

import {
  buildCreateDevicePayload,
  buildUpdateDevicePayload,
  type BuildBubblesCreateDevicePayloadOptions,
  type BuildBubblesDevicePayloadOptions,
  type BubblesCreateDevicePayload,
  type BubblesUpdateDevicePayload,
} from './device-payload';
import {
  getRequiredNonEmptyString,
  isPlainObject,
  normalizeIdentifier,
} from '../internal/validation';
import { failWithBubblesError } from '../internal/errors';

const APP_KEY_HEADER_NAME = 'X-App-Key';
const INVALID_APP_KEY_ERROR = 'invalid app key for app';

export class BubblesAppAuthenticationError extends Error {
  readonly cause: unknown;

  constructor(cause?: unknown) {
    super('Bubbles app configuration/authentication failed: invalid app key for app.');
    this.name = 'BubblesAppAuthenticationError';
    this.cause = cause;
  }
}

export interface BubblesDeviceClientOptions extends DeviceClientOptions {
  appKey?: string;
}

type DeviceClientFactoryOptions = Omit<BubblesDeviceClientOptions, 'baseUrl'>;

interface BubblesDeviceClientInput {
  apiBaseUrl?: string;
  appKey: string;
  client?: DeviceClient;
  clientOptions?: DeviceClientFactoryOptions;
}

export interface CreateBubblesDeviceOptions
  extends BuildBubblesCreateDevicePayloadOptions,
    BubblesDeviceClientInput {
  requestOptions?: RequestOptions;
}

export interface UpdateBubblesDeviceOptions
  extends BuildBubblesDevicePayloadOptions,
    BubblesDeviceClientInput {
  deviceId: string | number;
  requestOptions?: UpdateDeviceOptions;
}

export interface SyncBubblesDeviceOptions
  extends BuildBubblesCreateDevicePayloadOptions,
    BubblesDeviceClientInput {
  deviceId: string | number | null;
  createRequestOptions?: RequestOptions;
  updateRequestOptions?: UpdateDeviceOptions;
}

export interface SyncBubblesDeviceResult<TResponse = unknown> {
  action: 'created' | 'updated';
  deviceId: string | null;
  response: TResponse;
}

export type BubblesDeviceAttributeValue =
  | string
  | number
  | boolean
  | null
  | BubblesDeviceAttributeValue[]
  | { [key: string]: BubblesDeviceAttributeValue };

export type BubblesDeviceAttributes = Record<string, BubblesDeviceAttributeValue>;

export interface UpdateBubblesDeviceAttributesOptions
  extends BubblesDeviceClientInput {
  deviceId: string | number;
  attributes: BubblesDeviceAttributes;
  requestOptions?: RequestOptions;
}

function resolveDeviceClient(options: BubblesDeviceClientInput): DeviceClient {
  if (options.client) {
    return options.client;
  }

  return createBubblesDeviceClient({
    ...options.clientOptions,
    appKey: options.appKey,
    baseUrl: getRequiredNonEmptyString(options.apiBaseUrl, 'apiBaseUrl'),
  });
}

export function createBubblesDeviceClient(
  options: BubblesDeviceClientOptions,
): DeviceClient {
  const { appKey: rawAppKey, ...clientOptions } = options;
  const appKey = rawAppKey
    ? getRequiredNonEmptyString(rawAppKey, 'appKey')
    : null;

  return new DeviceClient({
    ...clientOptions,
    baseUrl: getRequiredNonEmptyString(clientOptions.baseUrl, 'apiBaseUrl'),
    defaultHeaders: {
      ...clientOptions.defaultHeaders,
      ...(appKey ? { [APP_KEY_HEADER_NAME]: appKey } : {}),
    },
  });
}

function withAppKeyHeader<TOptions extends RequestOptions | UpdateDeviceOptions>(
  appKey: string,
  requestOptions: TOptions | undefined,
): TOptions {
  return {
    ...requestOptions,
    headers: {
      ...requestOptions?.headers,
      [APP_KEY_HEADER_NAME]: getRequiredNonEmptyString(appKey, 'appKey'),
    },
  } as unknown as TOptions;
}

function isInvalidAppKeyResponse(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const status = Reflect.get(error, 'status');
  const body = Reflect.get(error, 'body');

  return (
    status === 401 &&
    !!body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Reflect.get(body, 'error') === INVALID_APP_KEY_ERROR
  );
}

function throwAppAuthenticationError(error: unknown): never {
  if (isInvalidAppKeyResponse(error)) {
    throw new BubblesAppAuthenticationError(error);
  }

  throw error;
}

function normalizeDeviceAttributes(
  value: BubblesDeviceAttributes,
): BubblesDeviceAttributes {
  return normalizeDeviceAttributeObject(value, 'attributes', new WeakSet());
}

function normalizeDeviceAttributeValue(
  value: unknown,
  sourceDescription: string,
  seenValues: WeakSet<object>,
): BubblesDeviceAttributeValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      failWithBubblesError(`${sourceDescription} must be a finite number.`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    if (seenValues.has(value)) {
      failWithBubblesError(`${sourceDescription} must not contain cycles.`);
    }

    seenValues.add(value);
    const normalizedValue = value.map((entry, index) =>
      normalizeDeviceAttributeValue(
        entry,
        `${sourceDescription}[${index}]`,
        seenValues,
      ),
    );
    seenValues.delete(value);

    return normalizedValue;
  }

  if (isPlainObject(value)) {
    return normalizeDeviceAttributeObject(
      value,
      sourceDescription,
      seenValues,
    );
  }

  failWithBubblesError(
    `${sourceDescription} must be a JSON-compatible value.`,
  );
}

function normalizeDeviceAttributeObject(
  value: unknown,
  sourceDescription: string,
  seenValues: WeakSet<object>,
): BubblesDeviceAttributes {
  if (!isPlainObject(value)) {
    failWithBubblesError('"attributes" must be an object.');
  }

  const valuePrototype = Object.getPrototypeOf(value);

  if (valuePrototype !== Object.prototype && valuePrototype !== null) {
    failWithBubblesError(
      `${sourceDescription} must be a JSON-compatible object.`,
    );
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    failWithBubblesError(
      `${sourceDescription} must not contain symbol keys.`,
    );
  }

  if (seenValues.has(value)) {
    failWithBubblesError(`${sourceDescription} must not contain cycles.`);
  }

  seenValues.add(value);
  const normalizedValue: BubblesDeviceAttributes = {};

  for (const [attributeName, attributeValue] of Object.entries(value)) {
    normalizedValue[attributeName] = normalizeDeviceAttributeValue(
      attributeValue,
      `${sourceDescription}.${attributeName}`,
      seenValues,
    );
  }

  seenValues.delete(value);

  return normalizedValue;
}

export function extractDeviceIdFromDeviceResponse(
  value: unknown,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const id = Reflect.get(value, 'id');

  if (typeof id === 'number') {
    return Number.isFinite(id) ? String(id) : null;
  }

  if (typeof id === 'string') {
    const trimmedId = id.trim();
    return trimmedId.length > 0 ? trimmedId : null;
  }

  return null;
}

export async function createBubblesDevice<TResponse = unknown>(
  options: CreateBubblesDeviceOptions,
): Promise<TResponse> {
  const client = resolveDeviceClient(options);
  const payload: BubblesCreateDevicePayload = buildCreateDevicePayload(options);

  try {
    return await client.createDevice<TResponse, BubblesCreateDevicePayload>(
      payload,
      withAppKeyHeader(options.appKey, options.requestOptions),
    );
  } catch (error) {
    throwAppAuthenticationError(error);
  }
}

export async function updateBubblesDevice<TResponse = unknown>(
  options: UpdateBubblesDeviceOptions,
): Promise<TResponse> {
  const client = resolveDeviceClient(options);
  const payload: BubblesUpdateDevicePayload = buildUpdateDevicePayload(options);

  try {
    return await client.updateDevice<TResponse, BubblesUpdateDevicePayload>(
      normalizeIdentifier(options.deviceId, 'deviceId'),
      payload,
      withAppKeyHeader(options.appKey, options.requestOptions),
    );
  } catch (error) {
    throwAppAuthenticationError(error);
  }
}

export async function updateBubblesDeviceAttributes<TResponse = unknown>(
  options: UpdateBubblesDeviceAttributesOptions,
): Promise<TResponse> {
  const client = resolveDeviceClient(options);

  try {
    return await client.updateDeviceAttributes<
      TResponse,
      BubblesDeviceAttributes
    >(
      normalizeIdentifier(options.deviceId, 'deviceId'),
      normalizeDeviceAttributes(options.attributes),
      withAppKeyHeader(options.appKey, options.requestOptions),
    );
  } catch (error) {
    throwAppAuthenticationError(error);
  }
}

export async function syncBubblesDevice<TResponse = unknown>(
  options: SyncBubblesDeviceOptions,
): Promise<SyncBubblesDeviceResult<TResponse>> {
  const client = resolveDeviceClient(options);

  if (options.deviceId !== null) {
    const deviceId = normalizeIdentifier(options.deviceId, 'deviceId');
    let response: TResponse;

    try {
      response = await client.updateDevice<TResponse, BubblesUpdateDevicePayload>(
        deviceId,
        buildUpdateDevicePayload(options),
        withAppKeyHeader(options.appKey, options.updateRequestOptions),
      );
    } catch (error) {
      throwAppAuthenticationError(error);
    }

    return {
      action: 'updated',
      deviceId,
      response,
    };
  }

  let response: TResponse;

  try {
    response = await client.createDevice<TResponse, BubblesCreateDevicePayload>(
      buildCreateDevicePayload(options),
      withAppKeyHeader(options.appKey, options.createRequestOptions),
    );
  } catch (error) {
    throwAppAuthenticationError(error);
  }

  return {
    action: 'created',
    deviceId: extractDeviceIdFromDeviceResponse(response),
    response,
  };
}
