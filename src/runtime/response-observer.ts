import * as Notifications from 'expo-notifications';

import { BUBBLES_DELIVERY_STATUSES } from '../api/delivery-status';
import { postStoredBubblesDeliveryStatus } from '../notifications/delivery-status';
import {
  getBubblesNotificationDataFromNotification,
  normalizeBubblesNotificationPayload,
} from '../notifications/payload';
import {
  readStoredDeviceState,
  type StoredDeviceState,
} from '../storage/device-state';

import type { BubblesNotificationResponseEvent } from './context';

export interface ObserveBubblesNotificationResponsesOptions {
  onNotificationResponse?: (
    event: BubblesNotificationResponseEvent,
  ) => void;
}

interface ObservedNotificationResponse {
  event: BubblesNotificationResponseEvent;
  notificationId: string | null;
}

function buildNotificationResponseKey(
  response: Notifications.NotificationResponse,
): string {
  const payload = normalizeBubblesNotificationPayload(
    getBubblesNotificationDataFromNotification(response.notification),
  );

  if (payload.notificationId) {
    return `notification:${payload.notificationId}:action:${response.actionIdentifier}`;
  }

  return `request:${response.notification.request.identifier}:action:${response.actionIdentifier}`;
}

function logNotificationResponseError(
  description: string,
  error: unknown,
) {
  console.error(
    `[@fishonfire/bubbles-expo] Failed during notification response ${description}.`,
    error,
  );
}

function buildObservedNotificationResponse(
  response: Notifications.NotificationResponse,
  storedDeviceState: StoredDeviceState,
): ObservedNotificationResponse {
  const payload = normalizeBubblesNotificationPayload(
    getBubblesNotificationDataFromNotification(response.notification),
  );

  return {
    notificationId: payload.notificationId,
    event: {
      notification: response.notification,
      url: payload.url,
      notificationId: payload.notificationId,
      deviceId: storedDeviceState.deviceId,
      data: payload.data,
    },
  };
}

function postNotificationClickedDeliveryStatus(
  storedDeviceState: StoredDeviceState,
  notificationId: string | null,
  actionId: string,
) {
  void postStoredBubblesDeliveryStatus({
    source: 'notification response',
    storedDeviceState,
    notificationId,
    status: BUBBLES_DELIVERY_STATUSES.notificationClicked,
    actionId,
  }).catch((error) => {
    logNotificationResponseError('delivery-status update', error);
  });
}

function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  options: ObserveBubblesNotificationResponsesOptions,
  source: 'startup' | 'listener',
) {
  const storedDeviceState = readStoredDeviceState();
  const observedResponse = buildObservedNotificationResponse(
    response,
    storedDeviceState,
  );

  postNotificationClickedDeliveryStatus(
    storedDeviceState,
    observedResponse.notificationId,
    response.actionIdentifier,
  );

  options.onNotificationResponse?.(observedResponse.event);
}

function processStartupNotificationResponse(
  processNotificationResponse: (
    response: Notifications.NotificationResponse,
  ) => void,
) {
  try {
    const lastResponse = Notifications.getLastNotificationResponse();

    if (!lastResponse) {
      return;
    }

    processNotificationResponse(lastResponse);
    Notifications.clearLastNotificationResponse();
  } catch (error) {
    logNotificationResponseError('initial response handling', error);
  }
}

export function observeBubblesNotificationResponses(
  options: ObserveBubblesNotificationResponsesOptions,
): () => void {
  let lastHandledResponseKey: string | null = null;

  const processNotificationResponse = (
    response: Notifications.NotificationResponse,
  ) => {
    const responseKey = buildNotificationResponseKey(response);

    if (lastHandledResponseKey === responseKey) {
      return;
    }

    lastHandledResponseKey = responseKey;
    handleNotificationResponse(response, options, 'listener');
  };

  processStartupNotificationResponse((response) => {
    const responseKey = buildNotificationResponseKey(response);
    lastHandledResponseKey = responseKey;
    handleNotificationResponse(response, options, 'startup');
  });

  const subscription = Notifications.addNotificationResponseReceivedListener(
    processNotificationResponse,
  );

  return () => {
    subscription.remove();
  };
}
