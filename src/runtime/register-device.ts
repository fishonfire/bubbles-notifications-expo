import type { RegisterDeviceOptions } from './context';
import type { PermissionRequestOptions } from './presentation';
import {
  syncDeviceRegistrationState,
  type SyncBubblesNotificationsDeviceResult,
} from './sync-device';
import { getBubblesDeviceRegistrationState } from './transport';

export interface RegisterBubblesDeviceOptions {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
  deviceId: string | null;
  registrationOptions?: RegisterDeviceOptions;
}

const DEFAULT_PERMISSION_REQUEST_OPTIONS: PermissionRequestOptions = {
  ios: {
    allowAlert: true,
    allowBadge: true,
    allowSound: true,
  },
};

function buildRegistrationOptions(
  options?: RegisterDeviceOptions,
): RegisterDeviceOptions {
  if (options?.requestPermissions === false) {
    return {
      requestPermissions: false,
      permissionRequestOptions: options.permissionRequestOptions,
    };
  }

  return {
    requestPermissions: options?.requestPermissions,
    permissionRequestOptions:
      options?.permissionRequestOptions ?? DEFAULT_PERMISSION_REQUEST_OPTIONS,
  };
}

export async function registerBubblesDevice(
  options: RegisterBubblesDeviceOptions,
): Promise<SyncBubblesNotificationsDeviceResult> {
  const registrationState = await getBubblesDeviceRegistrationState(
    buildRegistrationOptions(options.registrationOptions),
  );

  return syncDeviceRegistrationState({
    ...options,
    deviceId: options.deviceId,
    registrationState,
  });
}
