import {
  postBubblesDeliveryStatus,
  type BubblesDeliveryStatus,
} from '../api/delivery-status';
import {
  readStoredDeviceState,
  type StoredDeviceState,
} from '../storage/device-state';
import {
  createStoredDeliveryStatusEvent,
  enqueueStoredDeliveryStatusEvent,
  markStoredDeliveryStatusEventPosted,
  readStoredDeliveryStatusLedger,
  type StoredDeliveryStatusEvent,
} from '../storage/delivery-status-ledger';

export interface PostStoredBubblesDeliveryStatusOptions {
  source: string;
  notificationId: string | null;
  status?: BubblesDeliveryStatus;
  error?: string | null;
  actionId?: string | null;
  storedDeviceState?: StoredDeviceState;
}

function warnMissingApiBaseUrl(source: string) {
  console.warn(
    `[@fishonfire/bubbles-expo] Skipping ${source} delivery-status update because "apiBaseUrl" has not been persisted yet.`,
  );
}

function warnMissingAppKey(source: string) {
  console.warn(
    `[@fishonfire/bubbles-expo] Skipping ${source} delivery-status update because "appKey" has not been persisted yet.`,
  );
}

export async function postStoredBubblesDeliveryStatus(
  options: PostStoredBubblesDeliveryStatusOptions,
): Promise<StoredDeviceState> {
  const storedDeviceState = options.storedDeviceState ?? readStoredDeviceState();
  const { deviceId, apiBaseUrl, appKey } = storedDeviceState;

  if (!options.notificationId) {
    return storedDeviceState;
  }

  const event = createStoredDeliveryStatusEvent({
    notificationId: options.notificationId,
    status: options.status,
    error: options.error,
    actionId: options.actionId,
  });

  enqueueStoredDeliveryStatusEvent(event);

  if (!deviceId) {
    return storedDeviceState;
  }

  if (!apiBaseUrl) {
    warnMissingApiBaseUrl(options.source);
    return storedDeviceState;
  }

  if (!appKey) {
    warnMissingAppKey(options.source);
    return storedDeviceState;
  }

  await flushStoredBubblesDeliveryStatuses({
    apiBaseUrl,
    appKey,
    deviceId,
  });

  return storedDeviceState;
}

export async function flushStoredBubblesDeliveryStatuses(
  storedDeviceState: StoredDeviceState = readStoredDeviceState(),
): Promise<StoredDeviceState> {
  const { deviceId, apiBaseUrl, appKey } = storedDeviceState;

  if (!deviceId || !apiBaseUrl || !appKey) {
    return storedDeviceState;
  }

  const { pendingEvents } = readStoredDeliveryStatusLedger();

  for (const event of pendingEvents) {
    await postStoredDeliveryStatusEvent(apiBaseUrl, appKey, deviceId, event);
    markStoredDeliveryStatusEventPosted(event);
  }

  return storedDeviceState;
}

async function postStoredDeliveryStatusEvent(
  apiBaseUrl: string,
  appKey: string,
  deviceId: string,
  event: StoredDeliveryStatusEvent,
) {
  await postBubblesDeliveryStatus({
    apiBaseUrl,
    appKey,
    deviceId,
    notificationId: event.notificationId,
    status: event.status,
    error: event.error,
  });
}
