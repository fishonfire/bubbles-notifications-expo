import { resolveRegistrationIdentity, type OneSignalMigration } from './migration';
import type { RegisterDeviceOptions } from './context';
import type { PermissionRequestOptions } from './presentation';
import {
  syncDeviceRegistrationState,
  type SyncBubblesNotificationsDeviceResult,
} from './sync-device';
import { getBubblesDeviceRegistrationState } from './transport';

type DeviceRegistrationOptions = Pick<
  RegisterDeviceOptions,
  'requestPermissions' | 'permissionRequestOptions'
>;

export interface RegisterBubblesDeviceOptions {
  oneSignalMigration?: OneSignalMigration;
  isCurrent?: () => boolean;
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
  deviceId: string | null;
  loadDeviceId?: () => Promise<string | null>;
  registrationOptions?: DeviceRegistrationOptions;
  previousRegistrationState?: RegisterBubblesDeviceResult['registrationState'];
}

export interface RegisterBubblesDeviceResult
  extends SyncBubblesNotificationsDeviceResult {
  registrationState: Awaited<ReturnType<typeof getBubblesDeviceRegistrationState>> & {
    installationId?: string; oneSignalSubscriptionId?: string | null; registrationScope?: string;
  };
}

export interface MaintainBubblesDeviceOptions
  extends Omit<
    RegisterBubblesDeviceOptions,
    'deviceId' | 'loadDeviceId' | 'registrationOptions'
  > {
  deviceId: string;
  previousRegistrationState: RegisterBubblesDeviceResult['registrationState'];
}

export interface MaintainBubblesDeviceResult {
  registrationState: RegisterBubblesDeviceResult['registrationState'];
  syncResult: SyncBubblesNotificationsDeviceResult | null;
}

const DEFAULT_PERMISSION_REQUEST_OPTIONS: PermissionRequestOptions = {
  ios: {
    allowAlert: true,
    allowBadge: true,
    allowSound: true,
  },
};

function buildRegistrationOptions(
  options?: DeviceRegistrationOptions,
): DeviceRegistrationOptions {
  if (options?.requestPermissions !== true) {
    return {
      requestPermissions: false,
      permissionRequestOptions: options?.permissionRequestOptions,
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
): Promise<RegisterBubblesDeviceResult> {
  const {
    loadDeviceId,
    registrationOptions,
    previousRegistrationState,
    ...syncOptions
  } = options;
  const registrationStatePromise = getBubblesDeviceRegistrationState(
    buildRegistrationOptions(registrationOptions),
  );
  const deviceIdPromise =
    syncOptions.deviceId === null && loadDeviceId
      ? loadDeviceId()
      : Promise.resolve(syncOptions.deviceId);
  const [tokenState] = await Promise.all([
    registrationStatePromise,
    deviceIdPromise,
  ]);

  const identity = await resolveRegistrationIdentity(options);
  if (options.isCurrent && !options.isCurrent()) throw new Error('Registration configuration changed.');
  const deviceId = identity.deviceId;
  const registrationState = { ...tokenState, installationId: identity.installationId,
    oneSignalSubscriptionId: identity.oneSignalSubscriptionId, registrationScope: identity.registrationScope };

  if (deviceId !== null && previousRegistrationState &&
      areRegistrationStatesEqual(previousRegistrationState, registrationState)) {
    return {
      action: 'unchanged',
      deviceId,
      pushToken: registrationState.token,
      tokenType: registrationState.tokenType,
      permissionStatus: registrationState.permissionStatus,
      notificationsEnabled: registrationState.notificationsEnabled,
      registrationState,
      attributeSync: { status: 'skipped', error: null },
    };
  }

  const result = await syncDeviceRegistrationState({
    ...syncOptions,
    deviceId,
    registrationIdentity: identity,
    registrationState,
    deferPostRegistrationWork: true,
  });

  return {
    ...result,
    registrationState,
  };
}

export async function syncExistingBubblesDevice(
  options: Omit<
    RegisterBubblesDeviceOptions,
    'deviceId' | 'loadDeviceId' | 'registrationOptions'
  > & {
    deviceId: string;
  },
): Promise<RegisterBubblesDeviceResult> {
  return registerBubblesDevice({
    ...options,
    registrationOptions: {
      requestPermissions: false,
    },
  });
}

function areRegistrationStatesEqual(
  left: RegisterBubblesDeviceResult['registrationState'],
  right: RegisterBubblesDeviceResult['registrationState'],
): boolean {
  return (
    left.installationId === right.installationId &&
    left.oneSignalSubscriptionId === right.oneSignalSubscriptionId &&
    left.registrationScope === right.registrationScope &&
    left.platform === right.platform &&
    left.tokenType === right.tokenType &&
    left.token === right.token &&
    left.fid === right.fid &&
    left.permissionStatus === right.permissionStatus &&
    left.notificationsEnabled === right.notificationsEnabled
  );
}

export async function maintainBubblesDevice(
  options: MaintainBubblesDeviceOptions,
): Promise<MaintainBubblesDeviceResult> {
  const tokenState = await getBubblesDeviceRegistrationState({ requestPermissions: false });
  const identity = await resolveRegistrationIdentity(options);
  if (options.isCurrent && !options.isCurrent()) throw new Error('Registration configuration changed.');
  const registrationState = { ...tokenState, installationId: identity.installationId,
    oneSignalSubscriptionId: identity.oneSignalSubscriptionId, registrationScope: identity.registrationScope };

  if (
    identity.deviceId !== null && areRegistrationStatesEqual(
      options.previousRegistrationState,
      registrationState,
    )
  ) {
    return {
      registrationState,
      syncResult: null,
    };
  }

  const syncResult = await syncDeviceRegistrationState({
    ...options,
    deviceId: identity.deviceId,
    registrationIdentity: identity,
    registrationState,
    deferPostRegistrationWork: true,
  });

  return {
    registrationState,
    syncResult,
  };
}
