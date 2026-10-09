import {
  BUBBLES_DELIVERY_STATUSES,
  postBubblesDeliveryStatus,
  type BubblesDeliveryStatus,
} from '../api/delivery-status';
import {
  readStoredDeviceStateAsync,
  type StoredDeviceState,
} from '../storage/device-state';
import {
  createStoredDeliveryStatusEvent,
  readStoredDeliveryStatusLedgerAsync,
  runDeliveryStatusLedgerServiceOperation,
  storeDeliveryStatusLedgerAsync,
  type StoredDeliveryStatusEvent,
} from '../storage/delivery-status-ledger';

export interface PostStoredBubblesDeliveryStatusOptions {
  source: string;
  notificationId: string | null;
  status?: BubblesDeliveryStatus;
  error?: string | null;
  storedDeviceState?: StoredDeviceState;
}

export interface ObserveStoredBubblesDeliveryStatusOptions {
  source: string;
  notificationId: string | null;
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
  const storedDeviceState =
    options.storedDeviceState ?? (await readStoredDeviceStateAsync());
  const { deviceId, apiBaseUrl, appKey } = storedDeviceState;

  if (!options.notificationId) {
    return storedDeviceState;
  }

  const event = createStoredDeliveryStatusEvent({
    notificationId: options.notificationId,
    status: options.status,
    error: options.error,
  });

  await runDeliveryStatusLedgerServiceOperation(async () => {
    const ledger = await readStoredDeliveryStatusLedgerAsync();

    if (
      !ledger.postedEventKeys.includes(event.key) &&
      !ledger.pendingEvents.some(
        (pendingEvent) => pendingEvent.key === event.key,
      )
    ) {
      await storeDeliveryStatusLedgerAsync({
        ...ledger,
        pendingEvents: [...ledger.pendingEvents, event],
      });
    }

    if (!deviceId) {
      return;
    }

    if (!apiBaseUrl) {
      warnMissingApiBaseUrl(options.source);
      return;
    }

    if (!appKey) {
      warnMissingAppKey(options.source);
      return;
    }

    await flushStoredBubblesDeliveryStatusesInOperation({
      apiBaseUrl,
      appKey,
      deviceId,
    });
  });

  return storedDeviceState;
}

export function observeStoredBubblesNotificationReceived(
  options: ObserveStoredBubblesDeliveryStatusOptions,
): Promise<StoredDeviceState> {
  return postStoredBubblesDeliveryStatus({
    ...options,
    status: BUBBLES_DELIVERY_STATUSES.notificationReceived,
  });
}

export function observeStoredBubblesLocalDisplayRequested(
  options: ObserveStoredBubblesDeliveryStatusOptions,
): Promise<StoredDeviceState> {
  return postStoredBubblesDeliveryStatus({
    ...options,
    status: BUBBLES_DELIVERY_STATUSES.notificationShown,
  });
}

export function observeStoredBubblesNotificationClicked(
  options: ObserveStoredBubblesDeliveryStatusOptions,
): Promise<StoredDeviceState> {
  return postStoredBubblesDeliveryStatus({
    ...options,
    status: BUBBLES_DELIVERY_STATUSES.notificationClicked,
  });
}

export function observeStoredBubblesNotificationsDisabled(
  options: ObserveStoredBubblesDeliveryStatusOptions,
): Promise<StoredDeviceState> {
  return postStoredBubblesDeliveryStatus({
    ...options,
    status: BUBBLES_DELIVERY_STATUSES.notificationsDisabled,
  });
}

export async function flushStoredBubblesDeliveryStatuses(
  storedDeviceState?: StoredDeviceState,
): Promise<StoredDeviceState> {
  storedDeviceState ??= await readStoredDeviceStateAsync();
  const { deviceId, apiBaseUrl, appKey } = storedDeviceState;

  if (!deviceId || !apiBaseUrl || !appKey) {
    return storedDeviceState;
  }

  await runDeliveryStatusLedgerServiceOperation(() =>
    flushStoredBubblesDeliveryStatusesInOperation({
      deviceId,
      apiBaseUrl,
      appKey,
    }),
  );

  return storedDeviceState;
}

async function flushStoredBubblesDeliveryStatusesInOperation(
  storedDeviceState: {
    deviceId: string;
    apiBaseUrl: string;
    appKey: string;
  },
): Promise<void> {
  const { deviceId, apiBaseUrl, appKey } = storedDeviceState;
  let ledger = await readStoredDeliveryStatusLedgerAsync();

  for (const event of ledger.pendingEvents) {
    await postStoredDeliveryStatusEvent(apiBaseUrl, appKey, deviceId, event);
    const postedEventKeys = ledger.postedEventKeys.includes(event.key)
      ? ledger.postedEventKeys
      : [...ledger.postedEventKeys, event.key];

    ledger = await storeDeliveryStatusLedgerAsync({
      pendingEvents: ledger.pendingEvents.filter(
        (pendingEvent) => pendingEvent.key !== event.key,
      ),
      postedEventKeys,
    });
  }
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
