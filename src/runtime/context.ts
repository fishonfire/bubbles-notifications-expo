import { createContext, type ReactNode } from 'react';
import type { Notification } from 'expo-notifications';

import type { PermissionRequestOptions } from './permissions';
import type { NativeTokenType } from './tokens';

export interface RegisterDeviceOptions {
  requestPermissions?: boolean;
  permissionRequestOptions?: PermissionRequestOptions;
}

export interface ForegroundPresentationOptions {
  shouldShowBanner?: boolean;
  shouldShowList?: boolean;
  shouldPlaySound?: boolean;
  shouldSetBadge?: boolean;
}

export interface BubblesNotificationsLogoutEvent {
  previousUserId: string;
  deviceId: string | null;
}

export interface BubblesNotificationResponseEvent {
  notification: Notification;
  url: string | null;
  notificationId: string | null;
  deviceId: string | null;
  data: Record<string, unknown>;
}

export interface BubblesNotificationsProviderProps {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  ready: boolean;
  userId: string | null;
  aliasing?: string[];
  appVersion?: string | null;
  onLogout?: (
    event: BubblesNotificationsLogoutEvent,
  ) => Promise<void> | void;
  foregroundPresentation?: ForegroundPresentationOptions;
  onNotificationResponse?: (
    event: BubblesNotificationResponseEvent,
  ) => void;
  children: ReactNode;
}

export interface BubblesNotificationsContextValue {
  registerDevice: (options?: RegisterDeviceOptions) => Promise<void>;
  deviceId: string | null;
  pushToken: string | null;
  tokenType: NativeTokenType | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
  isSyncing: boolean;
  error: Error | null;
}

export const BubblesNotificationsContext =
  createContext<BubblesNotificationsContextValue | null>(null);
