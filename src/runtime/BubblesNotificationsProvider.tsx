import { useEffect, useRef, useState } from 'react';

import { failWithBubblesError } from '../internal/errors';
import { getRequiredNonEmptyString } from '../internal/validation';
import { storeApiBaseUrl, storeAppKey } from '../storage/device-state';
import {
  updateBubblesDeviceAttributes,
  type BubblesDeviceAttributeValue,
} from '../api/device-client';

import {
  BubblesNotificationsContext,
  type BubblesNotificationsProviderProps,
  type RegisterDeviceOptions,
} from './context';
import {
  applyBubblesForegroundPresentation,
  clearBubblesForegroundPresentation,
  observeBubblesNotificationOpenEvents,
  prepareBubblesNotificationPresentation,
} from './presentation';
import { registerBubblesDevice } from './register-device';
import { useBubblesRuntimeOperationQueue } from './provider-operation-queue';
import {
  getAutomaticSyncSignature,
  getInitialRuntimeState,
  getRuntimeStateUpdate,
  normalizeProviderError,
  normalizeUserId,
} from './provider-state';
import {
  syncExistingBubblesDevice,
} from './sync-device';
import { observeBubblesForegroundRemoteMessages } from './transport';

export function BubblesNotificationsProvider(
  props: BubblesNotificationsProviderProps,
) {
  const {
    appId,
    appKey,
    apiBaseUrl,
    ready,
    userId,
    aliasing,
    appVersion,
    onLogout,
    foregroundPresentation,
    onNotificationResponse,
    children,
  } = props;
  const normalizedUserId = normalizeUserId(userId);
  const [state, setState] = useState(getInitialRuntimeState);
  const { enqueueOperation, isMountedRef } =
    useBubblesRuntimeOperationQueue(setState);
  const lastAutomaticSyncSignatureRef = useRef<string | null>(null);
  const previousUserIdRef = useRef<string | null>(normalizedUserId);

  function buildAutomaticSyncSignature(deviceId: string): string {
    return getAutomaticSyncSignature({
      appId,
      appKey,
      apiBaseUrl,
      userId: normalizedUserId as string,
      aliasing,
      appVersion,
      deviceId,
    });
  }

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      clearBubblesForegroundPresentation();
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        storeApiBaseUrl(getRequiredNonEmptyString(apiBaseUrl, 'apiBaseUrl'));
        storeAppKey(getRequiredNonEmptyString(appKey, 'appKey'));
        await prepareBubblesNotificationPresentation();
      } catch (error) {
        if (!isCancelled && isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            error: normalizeProviderError(error),
          }));
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [apiBaseUrl, appKey]);

  useEffect(() => {
    applyBubblesForegroundPresentation(foregroundPresentation);
  }, [
    foregroundPresentation?.shouldPlaySound,
    foregroundPresentation?.shouldSetBadge,
    foregroundPresentation?.shouldShowBanner,
    foregroundPresentation?.shouldShowList,
  ]);

  useEffect(() => {
    return observeBubblesForegroundRemoteMessages();
  }, []);

  useEffect(() => {
    return observeBubblesNotificationOpenEvents({
      onNotificationResponse,
    });
  }, [onNotificationResponse]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;

    if (previousUserId !== null && normalizedUserId === null) {
      lastAutomaticSyncSignatureRef.current = null;

      if (onLogout) {
        void enqueueOperation(async () => {
          await onLogout({
            previousUserId,
            deviceId: state.deviceId,
          });
        });
      }
    }

    previousUserIdRef.current = normalizedUserId;
  }, [normalizedUserId, onLogout, state.deviceId]);

  useEffect(() => {
    if (!ready || normalizedUserId === null || state.deviceId === null) {
      lastAutomaticSyncSignatureRef.current = null;
      return;
    }

    const syncSignature = buildAutomaticSyncSignature(state.deviceId);

    if (lastAutomaticSyncSignatureRef.current === syncSignature) {
      return;
    }

    lastAutomaticSyncSignatureRef.current = syncSignature;
    const storedDeviceId = state.deviceId;

    void enqueueOperation(async () => {
      const result = await syncExistingBubblesDevice({
        appId,
        appKey,
        apiBaseUrl,
        userId: normalizedUserId,
        aliasing,
        appVersion,
        deviceId: storedDeviceId,
      });

      return getRuntimeStateUpdate(result);
    });
  }, [
    ready,
    normalizedUserId,
    state.deviceId,
    appId,
    appKey,
    apiBaseUrl,
    aliasing,
    appVersion,
  ]);

  function registerDevice(options?: RegisterDeviceOptions) {
    return enqueueOperation(async () => {
      if (!ready) {
        failWithBubblesError(
          '"registerDevice()" requires "ready" to be true before the device can be synced.',
        );
      }

      if (normalizedUserId === null) {
        failWithBubblesError(
          '"registerDevice()" requires a non-null "userId" before the device can be synced.',
        );
      }

      const result = await registerBubblesDevice({
        appId,
        appKey,
        apiBaseUrl,
        userId: normalizedUserId,
        aliasing,
        appVersion,
        deviceId: state.deviceId,
        registrationOptions: options,
      });

      if (result.deviceId !== null) {
        lastAutomaticSyncSignatureRef.current = buildAutomaticSyncSignature(
          result.deviceId,
        );
      }

      return getRuntimeStateUpdate(result);
    });
  }

  function addDeviceAttribute(
    name: string,
    value: BubblesDeviceAttributeValue,
  ) {
    return enqueueOperation(async () => {
      const attributeName = getRequiredNonEmptyString(name, 'attributeName');

      if (value === undefined) {
        failWithBubblesError(
          '"addDeviceAttribute()" requires "value" to be a JSON-compatible value.',
        );
      }

      if (state.deviceId === null) {
        failWithBubblesError(
          '"addDeviceAttribute()" requires a backend "deviceId" before attributes can be synced.',
        );
      }

      await updateBubblesDeviceAttributes({
        apiBaseUrl,
        appKey,
        deviceId: state.deviceId,
        attributes: {
          [attributeName]: value,
        },
      });
    });
  }

  const contextValue = {
    registerDevice,
    addDeviceAttribute,
    deviceId: state.deviceId,
    pushToken: state.pushToken,
    tokenType: state.tokenType,
    permissionStatus: state.permissionStatus,
    notificationsEnabled: state.notificationsEnabled,
    isSyncing: state.isSyncing,
    error: state.error,
  };

  return (
    <BubblesNotificationsContext.Provider value={contextValue}>
      {children}
    </BubblesNotificationsContext.Provider>
  );
}
