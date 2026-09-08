import * as Notifications from 'expo-notifications';

import type { ForegroundPresentationOptions } from './context';

const DEFAULT_FOREGROUND_PRESENTATION = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false,
} as const satisfies Required<ForegroundPresentationOptions>;

export function applyBubblesNotificationHandler(
  options?: ForegroundPresentationOptions,
): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const presentation = {
        shouldShowBanner:
          options?.shouldShowBanner ??
          DEFAULT_FOREGROUND_PRESENTATION.shouldShowBanner,
        shouldShowList:
          options?.shouldShowList ??
          DEFAULT_FOREGROUND_PRESENTATION.shouldShowList,
        shouldPlaySound:
          options?.shouldPlaySound ??
          DEFAULT_FOREGROUND_PRESENTATION.shouldPlaySound,
        shouldSetBadge:
          options?.shouldSetBadge ??
          DEFAULT_FOREGROUND_PRESENTATION.shouldSetBadge,
      };

      return presentation;
    },
  });
}

export function clearBubblesNotificationHandler(): void {
  Notifications.setNotificationHandler(null);
}
