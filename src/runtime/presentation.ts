import type { ForegroundPresentationOptions } from './context';
import {
  ensureDefaultNotificationChannel,
  type EnsureDefaultNotificationChannelOptions,
} from './channels';
import {
  applyBubblesNotificationHandler,
  clearBubblesNotificationHandler,
} from './notification-handler';
import {
  describeNotificationPermissionStatus,
  ensureNotificationPermissions,
  getNotificationPermissions,
  isNotificationPermissionGranted,
  type GetNotificationPermissionsOptions,
  type PermissionRequestOptions,
} from './permissions';
import {
  observeBubblesNotificationResponses,
  type ObserveBubblesNotificationResponsesOptions,
} from './response-observer';

export type {
  EnsureDefaultNotificationChannelOptions,
  GetNotificationPermissionsOptions,
  ObserveBubblesNotificationResponsesOptions,
  PermissionRequestOptions,
};

export {
  describeNotificationPermissionStatus,
  ensureNotificationPermissions,
  getNotificationPermissions,
  isNotificationPermissionGranted,
};

export function applyBubblesForegroundPresentation(
  options?: ForegroundPresentationOptions,
): void {
  applyBubblesNotificationHandler(options);
}

export function clearBubblesForegroundPresentation(): void {
  clearBubblesNotificationHandler();
}

export function observeBubblesNotificationOpenEvents(
  options: ObserveBubblesNotificationResponsesOptions,
): () => void {
  return observeBubblesNotificationResponses(options);
}

export async function prepareBubblesNotificationPresentation(
  options?: EnsureDefaultNotificationChannelOptions,
) {
  return ensureDefaultNotificationChannel(options);
}
