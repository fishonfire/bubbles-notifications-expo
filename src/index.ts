export { registerBubblesBackgroundHandlers } from './background/setup'
export { BubblesNotificationsProvider } from './runtime/BubblesNotificationsProvider'
export { useBubblesNotifications } from './runtime/useBubblesNotifications'
export { ensureDefaultNotificationChannel } from './runtime/channels'
export type {
  DefaultNotificationChannelConfig,
  EnsureDefaultNotificationChannelOptions
} from './runtime/channels'
export {
  ensureNotificationPermissions,
  getNotificationPermissions,
  isNotificationPermissionGranted
} from './runtime/permissions'
export type {
  GetNotificationPermissionsOptions,
  PermissionRequestOptions
} from './runtime/permissions'
export { getFCMToken } from './runtime/tokens'
export type { GetDeviceTokenOptions } from './runtime/tokens'
export type {
  BubblesDeviceAttributes,
  BubblesDeviceAttributeValue
} from './api/device-client'
export type {
  BubblesForegroundNotificationPayloadContract,
  BubblesNotificationDataContract,
  BubblesSilentNotificationPayloadContract,
  BubblesVisibleNotificationPayloadContract
} from './notifications/payload'
export type {
  BubblesNotificationResponseEvent,
  BubblesNotificationsContextValue,
  BubblesNotificationsProviderProps,
  ForegroundPresentationOptions,
  RegisterDevice,
  RegisterDeviceOptions
} from './runtime/context'
export type { AndroidChannelImportance } from './config/runtime-config'

export type { OneSignalMigrationBridge, OneSignalMigration } from './runtime/migration'
export { BubblesMigrationPendingError } from './runtime/migration'
export { BubblesDeviceIdentityError, BubblesAppAuthenticationError } from './api/device-client'
