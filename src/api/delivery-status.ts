import type {
  DeviceClient,
  DeviceClientOptions,
  RequestOptions,
} from '@fishonfire/bubbles-js';

import {
  BubblesAppAuthenticationError,
  createBubblesDeviceClient,
} from './device-client';
import {
  getRequiredNonEmptyString,
  normalizeIdentifier,
} from '../internal/validation';
import { failWithBubblesError } from '../internal/errors';

type DeviceClientFactoryOptions = Omit<DeviceClientOptions, 'baseUrl'>;

/**
 * Public delivery status labels accepted by the Bubbles device API.
 *
 * Client-side notification callbacks are source-specific observations:
 * "received" means app-observed, "shown" may be
 * confirmed/requested/inferred depending on source, "clicked"
 * means app-observed user interaction, and "disabled" describes
 * permission/device capability.
 */
export const BUBBLES_DELIVERY_STATUSES = {
  notificationReceived: 'received',
  notificationShown: 'shown',
  notificationClicked: 'clicked',
  notificationsDisabled: 'disabled',
} as const;

export type BubblesDeliveryStatus =
  (typeof BUBBLES_DELIVERY_STATUSES)[keyof typeof BUBBLES_DELIVERY_STATUSES];

export interface BubblesDeliveryStatusPayload {
  status?: BubblesDeliveryStatus;
  error?: string;
}

export interface BuildBubblesDeliveryStatusPayloadOptions {
  status?: BubblesDeliveryStatus;
  error?: string | null;
}

export interface PostBubblesDeliveryStatusOptions
  extends BuildBubblesDeliveryStatusPayloadOptions {
  apiBaseUrl?: string;
  appKey: string;
  deviceId: string | number;
  notificationId: string | number;
  client?: DeviceClient;
  clientOptions?: DeviceClientFactoryOptions;
  requestOptions?: RequestOptions;
}

function normalizeError(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    failWithBubblesError('"error" must be a string when present.');
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    failWithBubblesError('"error" must not be empty when present.');
  }

  return trimmedValue;
}

function normalizeStatus(value: unknown): BubblesDeliveryStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  const supportedValues = Object.values(BUBBLES_DELIVERY_STATUSES);

  if (
    typeof value !== 'string' ||
    !supportedValues.includes(value as BubblesDeliveryStatus)
  ) {
    failWithBubblesError(
      `"status" must be one of: ${supportedValues.join(', ')}.`,
    );
  }

  return value as BubblesDeliveryStatus;
}

function resolveDeviceClient(
  options: PostBubblesDeliveryStatusOptions,
): DeviceClient {
  if (options.client) {
    return options.client;
  }

  return createBubblesDeviceClient({
    ...options.clientOptions,
    appKey: getRequiredNonEmptyString(options.appKey, 'appKey'),
    baseUrl: getRequiredNonEmptyString(options.apiBaseUrl, 'apiBaseUrl'),
  });
}

function withAppKeyHeader(
  appKey: string,
  requestOptions: RequestOptions | undefined,
): RequestOptions {
  return {
    ...requestOptions,
    headers: {
      ...requestOptions?.headers,
      'X-App-Key': getRequiredNonEmptyString(appKey, 'appKey'),
    },
  };
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
    Reflect.get(body, 'error') === 'invalid app key for app'
  );
}

export function buildBubblesDeliveryStatusPayload(
  options: BuildBubblesDeliveryStatusPayloadOptions,
): BubblesDeliveryStatusPayload {
  const status = normalizeStatus(options.status);
  const error = normalizeError(options.error);

  if (!status && !error) {
    failWithBubblesError(
      'A delivery status payload must include "status" and/or "error".',
    );
  }

  return {
    ...(status ? { status } : {}),
    ...(error ? { error } : {}),
  };
}

export async function postBubblesDeliveryStatus(
  options: PostBubblesDeliveryStatusOptions,
): Promise<void> {
  const client = resolveDeviceClient(options);

  try {
    await client.postDeliveryStatus(
      normalizeIdentifier(options.deviceId, 'deviceId'),
      normalizeIdentifier(options.notificationId, 'notificationId'),
      buildBubblesDeliveryStatusPayload(options),
      withAppKeyHeader(options.appKey, options.requestOptions),
    );
  } catch (error) {
    if (isInvalidAppKeyResponse(error)) {
      throw new BubblesAppAuthenticationError(error);
    }

    throw error;
  }
}
