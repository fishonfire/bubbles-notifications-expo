import {
  updateBubblesDeviceAttributes as updateBubblesDeviceAttributesInternal,
  type UpdateBubblesDeviceAttributesOptions,
} from './api/device-client';
import {
  readStoredApiBaseUrl as readStoredApiBaseUrlInternal,
  readStoredAppKey as readStoredAppKeyInternal,
  readStoredDeviceId as readStoredDeviceIdInternal,
} from './storage/device-state';

export type { UpdateBubblesDeviceAttributesOptions } from './api/device-client';

/** @deprecated Use `useBubblesNotifications().setDeviceAttributes()` instead. */
export function updateBubblesDeviceAttributes<TResponse = unknown>(
  options: UpdateBubblesDeviceAttributesOptions,
): Promise<TResponse> {
  return updateBubblesDeviceAttributesInternal<TResponse>(options);
}

/** @deprecated Device persistence is an internal implementation detail. */
export function readStoredDeviceId(): string | null {
  return readStoredDeviceIdInternal();
}

/** @deprecated Device persistence is an internal implementation detail. */
export function readStoredApiBaseUrl(): string | null {
  return readStoredApiBaseUrlInternal();
}

/** @deprecated Device persistence is an internal implementation detail. */
export function readStoredAppKey(): string | null {
  return readStoredAppKeyInternal();
}
