import type { ForegroundPresentationOptions } from './context';
import {
  ensureDefaultNotificationChannel,
  type EnsureDefaultNotificationChannelOptions,
} from './channels';
import {
  acquireBubblesNotificationHandler,
  updateBubblesNotificationHandler,
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

export function acquireBubblesForegroundPresentation(
  owner: object,
): () => void {
  return acquireBubblesNotificationHandler(owner);
}

export function updateBubblesForegroundPresentation(
  owner: object,
  options?: ForegroundPresentationOptions,
): void {
  updateBubblesNotificationHandler(owner, options);
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
