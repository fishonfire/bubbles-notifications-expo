export const BUBBLES_NOTIFICATIONS_EXPO_EXTRA_KEY =
  'bubblesNotificationsExpo';

export const ANDROID_CHANNEL_IMPORTANCE_VALUES = [
  'min',
  'low',
  'default',
  'high',
  'max',
] as const;

export type AndroidChannelImportance =
  (typeof ANDROID_CHANNEL_IMPORTANCE_VALUES)[number];
