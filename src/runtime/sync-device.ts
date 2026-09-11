import {
  syncBubblesDevice,
  updateBubblesDeviceAttributes,
} from '../api/device-client';
import {
  storeApiBaseUrl,
  storeAppKey,
  storeDeviceId,
} from '../storage/device-state';

import {
  getBubblesDeviceRegistrationState,
  getBubblesInstallationId,
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

export interface SyncExistingBubblesDeviceOptions
  extends BaseSyncDeviceOptions {
  deviceId: string;
}

export interface SyncDeviceRegistrationStateOptions
  extends BaseSyncDeviceOptions {
  deviceId: string | null;
  registrationState: DeviceRegistrationState;
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
  action: 'created' | 'updated';
}

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

async function syncBubblesDeviceAttributesBestEffort(
  apiBaseUrl: string,
  appKey: string,
  deviceId: string,
): Promise<void> {
  try {
    const attributes = await collectBubblesDeviceAttributes();

    if (Object.keys(attributes).length > 0) {
      await updateBubblesDeviceAttributes({
        apiBaseUrl,
        appKey,
        deviceId,
        attributes,
      });
    }
  } catch {
    // Device attribute delivery is opportunistic and must not invalidate registration.
  }
}

export async function syncDeviceRegistrationState(
  options: SyncDeviceRegistrationStateOptions,
): Promise<SyncBubblesNotificationsDeviceResult> {
  const apiBaseUrl = getRequiredNonEmptyString(options.apiBaseUrl, 'apiBaseUrl');
  const appKey = getRequiredNonEmptyString(options.appKey, 'appKey');
  storeApiBaseUrl(apiBaseUrl);
  storeAppKey(appKey);

  const snapshot = buildRuntimeSnapshot(
    options.deviceId,
    options.registrationState,
  );

  try {
    const installationId = options.registrationState.notificationsEnabled
      ? await getBubblesInstallationId(options.registrationState.platform)
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

    storeDeviceId(nextDeviceId);

    if (nextDeviceId) {
      await syncBubblesDeviceAttributesBestEffort(
        apiBaseUrl,
        appKey,
        nextDeviceId,
      );
    }

    return {
      ...snapshot,
      action: syncResult.action,
      deviceId: nextDeviceId,
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

export async function syncExistingBubblesDevice(
  options: SyncExistingBubblesDeviceOptions,
): Promise<SyncBubblesNotificationsDeviceResult> {
  const registrationState = await getBubblesDeviceRegistrationState({
    requestPermissions: false,
  });

  return syncDeviceRegistrationState({
    ...options,
    deviceId: options.deviceId,
    registrationState,
  });
}
