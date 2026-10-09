import * as Notifications from 'expo-notifications';

import { observeStoredBubblesNotificationClicked } from '../notifications/delivery-status';
import {
  getBubblesNotificationDataFromNotification,
  normalizeBubblesNotificationPayload,
} from '../notifications/payload';

import type { BubblesNotificationResponseEvent } from './context';

const MAX_HANDLED_RESPONSE_KEYS = 200;
const handledResponseKeys = new Set<string>();

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
    return `notification:${payload.notificationId}`;
  }

  return `request:${response.notification.request.identifier}`;
}

function markNotificationResponseHandled(responseKey: string): boolean {
  if (handledResponseKeys.has(responseKey)) {
    return false;
  }

  handledResponseKeys.add(responseKey);

  if (handledResponseKeys.size > MAX_HANDLED_RESPONSE_KEYS) {
    const oldestResponseKey = handledResponseKeys.values().next().value;

    if (oldestResponseKey) {
      handledResponseKeys.delete(oldestResponseKey);
    }
  }

  return true;
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
      data: payload.data,
    },
  };
}

function postNotificationClickedDeliveryStatus(
  notificationId: string | null,
) {
  void observeStoredBubblesNotificationClicked({
    source: 'notification response',
    notificationId,
  }).catch((error) => {
    logNotificationResponseError('delivery-status update', error);
  });
}

function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  options: ObserveBubblesNotificationResponsesOptions,
) {
  const observedResponse = buildObservedNotificationResponse(response);

  postNotificationClickedDeliveryStatus(observedResponse.notificationId);
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
  const processNotificationResponse = (
    response: Notifications.NotificationResponse,
  ) => {
    const responseKey = buildNotificationResponseKey(response);

    if (!markNotificationResponseHandled(responseKey)) {
      return;
    }

    handleNotificationResponse(response, options);
  };

  processStartupNotificationResponse(processNotificationResponse);

  const subscription = Notifications.addNotificationResponseReceivedListener(
    processNotificationResponse,
  );

  return () => {
    subscription.remove();
  };
}
