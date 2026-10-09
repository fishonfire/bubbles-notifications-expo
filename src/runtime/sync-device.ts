import {
  syncBubblesDevice,
  updateBubblesDeviceAttributes,
} from '../api/device-client';
import {
  patchStoredDeviceStateAsync,
  storeDeviceIdAsync,
} from '../storage/device-state';
import { flushStoredBubblesDeliveryStatuses } from '../notifications/delivery-status';

import {
  type DeviceRegistrationState,
  type NativeTokenType,
} from './transport';
import { collectBubblesDeviceAttributes } from './device-attributes';

interface BaseSyncDeviceOptions {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
}

export interface SyncDeviceRegistrationStateOptions
  extends BaseSyncDeviceOptions {
  deviceId: string | null;
  registrationState: DeviceRegistrationState;
  deferPostRegistrationWork?: boolean;
}

export interface BubblesNotificationsRuntimeSnapshot {
  deviceId: string | null;
  pushToken: string | null;
  tokenType: NativeTokenType | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
}

export interface SyncBubblesNotificationsDeviceResult
  extends BubblesNotificationsRuntimeSnapshot {
  action: 'created' | 'updated' | 'unchanged';
  attributeSync: BubblesDeviceAttributeSyncResult;
}

export type BubblesDeviceAttributeSyncResult =
  | { status: 'succeeded'; error: null }
  | { status: 'skipped'; error: null }
  | { status: 'pending'; error: null }
  | { status: 'failed'; error: Error };

export class BubblesNotificationsSyncError extends Error {
  readonly snapshot: BubblesNotificationsRuntimeSnapshot;
  readonly cause: unknown;

  constructor(
    message: string,
    snapshot: BubblesNotificationsRuntimeSnapshot,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'BubblesNotificationsSyncError';
    this.snapshot = snapshot;
    this.cause = cause;
  }
}

function fail(message: string): never {
  throw new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function getRequiredNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    fail(`"${fieldName}" must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    fail(`"${fieldName}" must not be empty.`);
  }

  return trimmedValue;
}

function buildRuntimeSnapshot(
  deviceId: string | null,
  registrationState: DeviceRegistrationState,
): BubblesNotificationsRuntimeSnapshot {
  return {
    deviceId,
    pushToken: registrationState.token,
    tokenType: registrationState.tokenType,
    permissionStatus: registrationState.permissionStatus,
    notificationsEnabled: registrationState.notificationsEnabled,
  };
}

async function syncBubblesDeviceAttributes(
  apiBaseUrl: string,
  appKey: string,
  deviceId: string,
): Promise<BubblesDeviceAttributeSyncResult> {
  try {
    const attributes = await collectBubblesDeviceAttributes();

    if (Object.keys(attributes).length === 0) {
      return { status: 'skipped', error: null };
    }

    await updateBubblesDeviceAttributes({
      apiBaseUrl,
      appKey,
      deviceId,
      attributes,
    });

    return { status: 'succeeded', error: null };
  } catch (error) {
    const normalizedError = toError(error);

    console.error(
      '[@fishonfire/bubbles-expo] Failed to synchronize built-in device attributes after device registration.',
      normalizedError,
    );

    return { status: 'failed', error: normalizedError };
  }
}

export async function syncDeviceRegistrationState(
  options: SyncDeviceRegistrationStateOptions,
): Promise<SyncBubblesNotificationsDeviceResult> {
  const apiBaseUrl = getRequiredNonEmptyString(options.apiBaseUrl, 'apiBaseUrl');
  const appKey = getRequiredNonEmptyString(options.appKey, 'appKey');
  await patchStoredDeviceStateAsync({
    apiBaseUrl,
    appKey,
  });

  const snapshot = buildRuntimeSnapshot(
    options.deviceId,
    options.registrationState,
  );

  try {
    const installationId = options.registrationState.notificationsEnabled
      ? options.registrationState.fid
      : null;
    const syncResult = await syncBubblesDevice({
      apiBaseUrl,
      appId: options.appId,
      appKey,
      userId: options.userId,
      aliasing: options.aliasing,
      appVersion: options.appVersion,
      deviceId: options.deviceId,
      platform: options.registrationState.platform,
      pushToken: options.registrationState.token,
      fid: installationId,
      notificationsEnabled: options.registrationState.notificationsEnabled,
    });
    const nextDeviceId = syncResult.deviceId ?? options.deviceId;

    const storedDeviceState = await storeDeviceIdAsync(nextDeviceId);

    let attributeSync: BubblesDeviceAttributeSyncResult = {
      status: 'skipped',
      error: null,
    };

    if (nextDeviceId) {
      const syncAttributes = () => syncBubblesDeviceAttributes(apiBaseUrl, appKey, nextDeviceId);
      const flushDeliveryStatuses = async () => {
        try {
          await flushStoredBubblesDeliveryStatuses(storedDeviceState);
        } catch (error) {
          console.error(
            '[@fishonfire/bubbles-expo] Failed to flush stored delivery statuses after device synchronization.',
            error,
          );
        }
      };

      if (options.deferPostRegistrationWork) {
        // Neither task controls enrollment success. Each handles its own errors,
        // and a slow delivery-status request must not delay attribute syncing.
        attributeSync = { status: 'pending', error: null };
        void flushDeliveryStatuses();
        void syncAttributes();
      } else {
        await flushDeliveryStatuses();
        attributeSync = await syncAttributes();
      }
    }

    return {
      ...snapshot,
      action: syncResult.action,
      deviceId: nextDeviceId,
      attributeSync,
    };
  } catch (error) {
    const normalizedError = toError(error);

    throw new BubblesNotificationsSyncError(
      normalizedError.message,
      snapshot,
      error,
    );
  }
}
