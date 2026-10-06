import { createContext, type ReactNode } from 'react';
import type { Notification } from 'expo-notifications';

import type { PermissionRequestOptions } from './permissions';
import type {
  BubblesDeviceAttributes,
  BubblesDeviceAttributeValue,
} from '../api/device-client';

export interface RegisterDeviceOptions {
  userId: string;
  aliasing?: string[];
  appVersion?: string;
  requestPermissions?: boolean;
  permissionRequestOptions?: PermissionRequestOptions;
}

export interface RegisterDevice {
  (options: RegisterDeviceOptions): Promise<void>;
  /**
   * @deprecated Pass enrollment data to `registerDevice(options)` instead of
   * configuring it on `BubblesNotificationsProvider`.
   */
  (): Promise<void>;
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
  data: Record<string, unknown>;
}

export interface BubblesNotificationsProviderProps {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  /** @deprecated Call `registerDevice({ userId, ... })` after authentication. */
  ready?: boolean;
  /** @deprecated Pass `userId` to `registerDevice(options)`. */
  userId?: string | null;
  /** @deprecated Pass `aliasing` to `registerDevice(options)`. */
  aliasing?: string[];
  /** @deprecated Pass `appVersion` to `registerDevice(options)`. */
  appVersion?: string | null;
  /**
   * @deprecated No backend detach behavior is defined. Handle logout in the
   * consuming application instead.
   */
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
  registerDevice: RegisterDevice;
  setDeviceAttributes: (
    attributes: BubblesDeviceAttributes,
  ) => Promise<void>;
  /** @deprecated Use `setDeviceAttributes({ [name]: value })`. */
  addDeviceAttribute: (
    name: string,
    value: BubblesDeviceAttributeValue,
  ) => Promise<void>;
  notificationsEnabled: boolean;
  isSyncing: boolean;
  error: Error | null;
}

export const BubblesNotificationsContext =
  createContext<BubblesNotificationsContextValue | null>(null);
