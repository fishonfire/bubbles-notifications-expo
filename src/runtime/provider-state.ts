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

export function normalizeUserId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
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
  return createInitialRuntimeState(null, null);
}
