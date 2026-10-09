import * as Notifications from 'expo-notifications';

import type { ForegroundPresentationOptions } from './context';

const DEFAULT_FOREGROUND_PRESENTATION = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
} as const satisfies Required<ForegroundPresentationOptions>;

type NotificationHandlerOwner = object;

let activeOwner: NotificationHandlerOwner | null = null;
let currentPresentationOptions: ForegroundPresentationOptions | undefined;
let isNotificationHandlerInstalled = false;

function installBubblesNotificationHandler(): void {
  if (isNotificationHandlerInstalled) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner:
        currentPresentationOptions?.shouldShowBanner ??
        DEFAULT_FOREGROUND_PRESENTATION.shouldShowBanner,
      shouldShowList:
        currentPresentationOptions?.shouldShowList ??
        DEFAULT_FOREGROUND_PRESENTATION.shouldShowList,
      shouldPlaySound:
        currentPresentationOptions?.shouldPlaySound ??
        DEFAULT_FOREGROUND_PRESENTATION.shouldPlaySound,
      shouldSetBadge:
        currentPresentationOptions?.shouldSetBadge ??
        DEFAULT_FOREGROUND_PRESENTATION.shouldSetBadge,
    }),
  });
  isNotificationHandlerInstalled = true;
}

export function acquireBubblesNotificationHandler(
  owner: NotificationHandlerOwner,
): () => void {
  if (activeOwner !== null && activeOwner !== owner) {
    throw new Error(
      '[@fishonfire/bubbles-expo] Only one BubblesNotificationsProvider may be mounted at a time.',
    );
  }

  installBubblesNotificationHandler();
  activeOwner = owner;

  return () => {
    if (activeOwner === owner) {
      activeOwner = null;
      currentPresentationOptions = undefined;
    }
  };
}

export function updateBubblesNotificationHandler(
  owner: NotificationHandlerOwner,
  options?: ForegroundPresentationOptions,
): void {
  if (activeOwner !== owner) {
    return;
  }

  currentPresentationOptions = options;
}
