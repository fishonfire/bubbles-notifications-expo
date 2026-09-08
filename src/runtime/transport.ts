import {
  observeBubblesForegroundMessages,
} from './foreground-message-observer';
import { getFirebaseInstallationId } from './installations';
import {
  getDeviceRegistrationState,
  getDeviceToken,
  getFCMToken,
  type DeviceRegistrationState,
  type DeviceTokenResult,
  type GetDeviceTokenOptions,
  type NativeTokenType,
  type SupportedPlatform,
} from './tokens';

export type {
  DeviceRegistrationState,
  DeviceTokenResult,
  GetDeviceTokenOptions,
  NativeTokenType,
  SupportedPlatform,
};

export function observeBubblesForegroundRemoteMessages(): () => void {
  return observeBubblesForegroundMessages();
}

export async function getBubblesDeviceRegistrationState(
  options?: GetDeviceTokenOptions,
): Promise<DeviceRegistrationState> {
  return getDeviceRegistrationState(options);
}

export async function getBubblesDeviceToken(
  options?: GetDeviceTokenOptions,
): Promise<DeviceTokenResult> {
  return getDeviceToken(options);
}

export async function getBubblesFCMToken(
  options?: GetDeviceTokenOptions,
): Promise<string> {
  return getFCMToken(options);
}

export async function getBubblesInstallationId(
  platform: SupportedPlatform,
): Promise<string> {
  return getFirebaseInstallationId(platform);
}
