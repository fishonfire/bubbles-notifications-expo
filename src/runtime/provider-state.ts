import { readStoredDeviceId } from '../storage/device-state';

import type { BubblesNotificationsRuntimeSnapshot } from './sync-device';
import type { NativeTokenType } from './tokens';

export interface BubblesNotificationsRuntimeState {
  deviceId: string | null;
  pushToken: string | null;
  tokenType: NativeTokenType | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
  isSyncing: boolean;
  error: Error | null;
}

export type RuntimeStateUpdate = Pick<
  BubblesNotificationsRuntimeState,
  | 'deviceId'
  | 'pushToken'
  | 'tokenType'
  | 'permissionStatus'
  | 'notificationsEnabled'
>;

export type RuntimeOperation = () => Promise<RuntimeStateUpdate | void>;

export interface AutomaticSyncSignatureInput {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
  deviceId: string;
}

function createInitialRuntimeState(
  deviceId: string | null,
  error: Error | null,
): BubblesNotificationsRuntimeState {
  return {
    deviceId,
    pushToken: null,
    tokenType: null,
    permissionStatus: 'unknown',
    notificationsEnabled: false,
    isSyncing: false,
    error,
  };
}

export function normalizeProviderError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function normalizeUserId(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

export function getAutomaticSyncSignature(
  input: AutomaticSyncSignatureInput,
): string {
  return JSON.stringify({
    appId: input.appId,
    appKey: input.appKey,
    apiBaseUrl: input.apiBaseUrl,
    userId: input.userId,
    aliasing: input.aliasing ?? [],
    appVersion: input.appVersion ?? null,
    deviceId: input.deviceId,
  });
}

export function getRuntimeStateUpdate(
  snapshot: BubblesNotificationsRuntimeSnapshot,
): RuntimeStateUpdate {
  return {
    deviceId: snapshot.deviceId,
    pushToken: snapshot.pushToken,
    tokenType: snapshot.tokenType,
    permissionStatus: snapshot.permissionStatus,
    notificationsEnabled: snapshot.notificationsEnabled,
  };
}

export function getInitialRuntimeState(): BubblesNotificationsRuntimeState {
  try {
    return createInitialRuntimeState(readStoredDeviceId(), null);
  } catch (error) {
    return createInitialRuntimeState(
      null,
      normalizeProviderError(error),
    );
  }
}
