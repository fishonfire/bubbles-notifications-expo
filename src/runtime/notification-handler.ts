import * as Notifications from 'expo-notifications'

import type { ForegroundPresentationOptions } from './context'

const DEFAULT_FOREGROUND_PRESENTATION = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: false,
  shouldSetBadge: false
} as const satisfies Required<ForegroundPresentationOptions>

type NotificationHandlerOwner = object

let activeLease: { owner: NotificationHandlerOwner } | null = null
let currentPresentationOptions: ForegroundPresentationOptions | undefined
let isNotificationHandlerInstalled = false

function installBubblesNotificationHandler (): void {
  if (isNotificationHandlerInstalled) {
    return
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
        DEFAULT_FOREGROUND_PRESENTATION.shouldSetBadge
    })
  })
  isNotificationHandlerInstalled = true
}

export function acquireBubblesNotificationHandler (
  owner: NotificationHandlerOwner
): () => void {
  installBubblesNotificationHandler()
  const lease = { owner }

  activeLease = lease
  currentPresentationOptions = undefined

  return () => {
    if (activeLease === lease) {
      activeLease = null
      currentPresentationOptions = undefined
    }
  }
}

export function updateBubblesNotificationHandler (
  owner: NotificationHandlerOwner,
  options?: ForegroundPresentationOptions
): void {
  if (activeLease?.owner !== owner) {
    return
  }

  currentPresentationOptions = options
}
