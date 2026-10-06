import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { failWithBubblesError } from '../internal/errors';
import { getRequiredNonEmptyString } from '../internal/validation';
import { flushStoredBubblesDeliveryStatuses } from '../notifications/delivery-status';
import {
  patchStoredDeviceStateAsync,
  readStoredDeviceIdAsync,
} from '../storage/device-state';
import {
  updateBubblesDeviceAttributes,
  type BubblesDeviceAttributes,
  type BubblesDeviceAttributeValue,
} from '../api/device-client';

import {
  BubblesNotificationsContext,
  type BubblesNotificationsProviderProps,
  type RegisterDevice,
  type RegisterDeviceOptions,
} from './context';
import {
  acquireBubblesForegroundPresentation,
  describeNotificationPermissionStatus,
  getNotificationPermissions,
  isNotificationPermissionGranted,
  observeBubblesNotificationOpenEvents,
  updateBubblesForegroundPresentation,
} from './presentation';
import {
  maintainBubblesDevice,
  registerBubblesDevice,
  type RegisterBubblesDeviceResult,
} from './register-device';
import { useBubblesRegistrationCoordinator } from './registration-coordinator';
import {
  getInitialRuntimeState,
  getRuntimeStateUpdate,
  normalizeProviderError,
  normalizeUserId,
} from './provider-state';
import {
  observeBubblesDeviceTokenRefresh,
  observeBubblesForegroundRemoteMessages,
} from './transport';

async function flushStoredDeliveryStatusesBestEffort(
  source: string,
  storedDeviceState?: Awaited<
    ReturnType<typeof patchStoredDeviceStateAsync>
  >,
): Promise<void> {
  try {
    await flushStoredBubblesDeliveryStatuses(storedDeviceState);
  } catch (error) {
    console.error(
      `[@fishonfire/bubbles-expo] Failed to flush stored delivery statuses ${source}.`,
      error,
    );
  }
}

interface EnrolledSession {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
  deviceId: string;
  registrationState: RegisterBubblesDeviceResult['registrationState'];
  source: 'explicit' | 'legacy';
}

interface ProviderConfiguration {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
}

function areProviderConfigurationsEqual(
  left: ProviderConfiguration,
  right: ProviderConfiguration,
): boolean {
  return (
    left.appId === right.appId &&
    left.appKey === right.appKey &&
    left.apiBaseUrl === right.apiBaseUrl
  );
}

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
  const normalizedUserId = normalizeUserId(userId ?? null);
  const [state, setState] = useState(getInitialRuntimeState);
  const {
    isMountedRef,
    runRegistration,
    waitForCurrentRegistration,
  } = useBubblesRegistrationCoordinator(setState);
  const currentDeviceIdRef = useRef<string | null>(state.deviceId);
  const foregroundPresentationOwnerRef = useRef({});
  const previousUserIdRef = useRef<string | null>(normalizedUserId);
  const enrolledSessionRef = useRef<EnrolledSession | null>(null);
  const enrollmentRequestVersionRef = useRef(0);
  const providerConfigurationVersionRef = useRef(0);
  const providerConfigurationRef = useRef<ProviderConfiguration>({
    appId,
    appKey,
    apiBaseUrl,
  });
  const maintenancePendingRef = useRef(false);
  const maintenanceRequestedRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  useLayoutEffect(() => {
    const providerConfiguration = { appId, appKey, apiBaseUrl };

    if (!areProviderConfigurationsEqual(
      providerConfigurationRef.current,
      providerConfiguration,
    )) {
      providerConfigurationRef.current = providerConfiguration;
      providerConfigurationVersionRef.current += 1;
      enrollmentRequestVersionRef.current += 1;
      enrolledSessionRef.current = null;
    }
  }, [appId, appKey, apiBaseUrl]);

  const requestMaintenance = useCallback(() => {
    if (enrolledSessionRef.current === null) {
      return;
    }

    maintenanceRequestedRef.current = true;

    if (maintenancePendingRef.current) {
      return;
    }

    maintenancePendingRef.current = true;

    void Promise.resolve().then(() => {
      void runRegistration(async () => {
        let runtimeStateUpdate;

        do {
          maintenanceRequestedRef.current = false;
          const enrolledSession = enrolledSessionRef.current;

          if (enrolledSession === null) {
            break;
          }

          const maintenanceResult = await maintainBubblesDevice({
            appId: enrolledSession.appId,
            appKey: enrolledSession.appKey,
            apiBaseUrl: enrolledSession.apiBaseUrl,
            userId: enrolledSession.userId,
            aliasing: enrolledSession.aliasing,
            appVersion: enrolledSession.appVersion,
            deviceId: enrolledSession.deviceId,
            previousRegistrationState:
              enrolledSession.registrationState,
          });

          if (enrolledSessionRef.current !== enrolledSession) {
            break;
          }

          const nextDeviceId =
            maintenanceResult.syncResult?.deviceId ??
            enrolledSession.deviceId;

          enrolledSessionRef.current = {
            ...enrolledSession,
            deviceId: nextDeviceId,
            registrationState: maintenanceResult.registrationState,
          };
          currentDeviceIdRef.current = nextDeviceId;
          runtimeStateUpdate = maintenanceResult.syncResult
            ? getRuntimeStateUpdate(maintenanceResult.syncResult)
            : {
                deviceId: nextDeviceId,
                pushToken: maintenanceResult.registrationState.token,
                tokenType: maintenanceResult.registrationState.tokenType,
                permissionStatus:
                  maintenanceResult.registrationState.permissionStatus,
                notificationsEnabled:
                  maintenanceResult.registrationState.notificationsEnabled,
              };
        } while (maintenanceRequestedRef.current);

        return runtimeStateUpdate;
      })
        .catch(() => undefined)
        .finally(() => {
          maintenancePendingRef.current = false;

          if (maintenanceRequestedRef.current) {
            requestMaintenance();
          }
        });
    });
  }, [runRegistration]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, [isMountedRef]);

  useEffect(() => {
    return acquireBubblesForegroundPresentation(
      foregroundPresentationOwnerRef.current,
    );
  }, []);

  useEffect(() => {
    currentDeviceIdRef.current = state.deviceId;
  }, [state.deviceId]);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const [storedDeviceState, permissions] = await Promise.all([
          patchStoredDeviceStateAsync({
            apiBaseUrl: getRequiredNonEmptyString(apiBaseUrl, 'apiBaseUrl'),
            appKey: getRequiredNonEmptyString(appKey, 'appKey'),
          }),
          getNotificationPermissions({ requestPermissions: false }),
        ]);

        if (isCancelled || !isMountedRef.current) {
          return;
        }

        currentDeviceIdRef.current = storedDeviceState.deviceId;
        setState((currentState) => ({
          ...currentState,
          deviceId: storedDeviceState.deviceId,
          permissionStatus:
            describeNotificationPermissionStatus(permissions),
          notificationsEnabled:
            isNotificationPermissionGranted(permissions),
          error: null,
        }));

        if (
          storedDeviceState.deviceId &&
          storedDeviceState.apiBaseUrl &&
          storedDeviceState.appKey
        ) {
          await flushStoredDeliveryStatusesBestEffort(
            'during provider startup',
            storedDeviceState,
          );
        }
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
  }, [apiBaseUrl, appKey, isMountedRef]);

  useEffect(() => {
    updateBubblesForegroundPresentation(
      foregroundPresentationOwnerRef.current,
      foregroundPresentation,
    );
  }, [foregroundPresentation]);

  useEffect(() => {
    return observeBubblesForegroundRemoteMessages();
  }, []);

  useEffect(() => {
    return observeBubblesDeviceTokenRefresh(() => {
      requestMaintenance();
    });
  }, [requestMaintenance]);

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState) => {
        const previousAppState = appStateRef.current;
        appStateRef.current = nextAppState;

        if (previousAppState !== 'active' && nextAppState === 'active') {
          void flushStoredDeliveryStatusesBestEffort(
            'after the app returned to the foreground',
          );
          requestMaintenance();
        }
      },
    );

    return () => {
      subscription.remove();
    };
  }, [requestMaintenance]);

  useEffect(() => {
    return observeBubblesNotificationOpenEvents({
      onNotificationResponse,
    });
  }, [onNotificationResponse]);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;

    if (previousUserId !== null && normalizedUserId === null) {
      if (enrolledSessionRef.current?.source === 'legacy') {
        enrolledSessionRef.current = null;
      }

      if (onLogout) {
        void Promise.resolve()
          .then(() => onLogout({
            previousUserId,
            deviceId: state.deviceId,
          }))
          .catch((error) => {
            console.error(
              '[@fishonfire/bubbles-expo] Deprecated onLogout callback failed.',
              error,
            );
          });
      }
    }

    previousUserIdRef.current = normalizedUserId;
  }, [normalizedUserId, onLogout, state.deviceId]);

  const registerDevice: RegisterDevice = (options?: RegisterDeviceOptions) => {
    const providerConfiguration = providerConfigurationRef.current;
    const requestVersion = enrollmentRequestVersionRef.current + 1;
    const providerConfigurationVersion =
      providerConfigurationVersionRef.current;
    enrollmentRequestVersionRef.current = requestVersion;
    const previousSession = enrolledSessionRef.current;
    enrolledSessionRef.current = null;

    return runRegistration(async () => {
      if (
        requestVersion !== enrollmentRequestVersionRef.current ||
        providerConfigurationVersion !==
          providerConfigurationVersionRef.current
      ) {
        return;
      }

      const usesLegacyEnrollment = options === undefined;

      if (usesLegacyEnrollment && !ready) {
        failWithBubblesError(
          'The deprecated zero-argument "registerDevice()" call requires the provider "ready" prop to be true.',
        );
      }

      const enrollmentUserId = usesLegacyEnrollment
        ? normalizedUserId
        : normalizeUserId(options?.userId);

      if (enrollmentUserId === null) {
        failWithBubblesError(
          '"registerDevice(options)" requires a non-empty "userId".',
        );
      }

      const enrollmentAliasing = usesLegacyEnrollment
        ? aliasing
        : options?.aliasing;
      const enrollmentAppVersion = usesLegacyEnrollment
        ? appVersion
        : options?.appVersion;

      const deviceId = currentDeviceIdRef.current;
      const sameSession = previousSession !== null &&
        areProviderConfigurationsEqual(previousSession, providerConfiguration) &&
        previousSession.deviceId === deviceId &&
        previousSession.userId === enrollmentUserId &&
        (previousSession.appVersion ?? null) === (enrollmentAppVersion ?? null) &&
        JSON.stringify(previousSession.aliasing ?? []) === JSON.stringify(enrollmentAliasing ?? []);

      const result = await registerBubblesDevice({
        ...providerConfiguration,
        userId: enrollmentUserId,
        aliasing: enrollmentAliasing,
        appVersion: enrollmentAppVersion,
        deviceId,
        loadDeviceId:
          deviceId === null ? readStoredDeviceIdAsync : undefined,
        registrationOptions: options,
        ...(sameSession ? {
          previousRegistrationState: previousSession.registrationState,
        } : {}),
      });

      if (
        requestVersion !== enrollmentRequestVersionRef.current ||
        providerConfigurationVersion !==
          providerConfigurationVersionRef.current
      ) {
        return;
      }

      currentDeviceIdRef.current = result.deviceId;

      if (result.deviceId !== null) {
        enrolledSessionRef.current = {
          ...providerConfiguration,
          userId: enrollmentUserId,
          aliasing: enrollmentAliasing ? [...enrollmentAliasing] : enrollmentAliasing,
          appVersion: enrollmentAppVersion,
          deviceId: result.deviceId,
          registrationState: result.registrationState,
          source: usesLegacyEnrollment ? 'legacy' : 'explicit',
        };
      }

      return getRuntimeStateUpdate(result);
    });
  };

  function setDeviceAttributes(attributes: BubblesDeviceAttributes) {
    return updateDeviceAttributes(() => attributes, 'setDeviceAttributes');
  }

  function updateDeviceAttributes(
    getAttributes: () => BubblesDeviceAttributes,
    operationName: 'addDeviceAttribute' | 'setDeviceAttributes',
  ) {
    return (async () => {
      await waitForCurrentRegistration();
      const attributes = getAttributes();

      const deviceId = currentDeviceIdRef.current;

      if (deviceId === null) {
        failWithBubblesError(
          `"${operationName}()" requires a backend "deviceId" before attributes can be synced.`,
        );
      }

      await updateBubblesDeviceAttributes({
        apiBaseUrl: providerConfigurationRef.current.apiBaseUrl,
        appKey: providerConfigurationRef.current.appKey,
        deviceId,
        attributes,
      });
    })().catch((error) => {
      const normalizedError = normalizeProviderError(error);

      if (isMountedRef.current) {
        setState((currentState) => ({
          ...currentState,
          error: normalizedError,
        }));
      }

      throw normalizedError;
    });
  }

  function addDeviceAttribute(
    name: string,
    value: BubblesDeviceAttributeValue,
  ) {
    return updateDeviceAttributes(() => {
      const attributeName = getRequiredNonEmptyString(name, 'attributeName');

      if (value === undefined) {
        failWithBubblesError(
          '"addDeviceAttribute()" requires "value" to be a JSON-compatible value.',
        );
      }

      return {
        [attributeName]: value,
      };
    }, 'addDeviceAttribute');
  }

  const contextValue = {
    registerDevice,
    setDeviceAttributes,
    addDeviceAttribute,
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
