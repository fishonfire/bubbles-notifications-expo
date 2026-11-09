import { useCallback, useRef, type RefObject } from 'react'
import type { AppState } from 'react-native'

import type { RegisterDevice, RegisterDeviceOptions } from './context'
import { retryBubblesLogout } from './logout'
import type { BubblesProviderConfiguration } from './provider-ownership'
import { getRuntimeStateUpdate, type EnrolledSession } from './provider-state'
import { maintainBubblesDevice } from './register-device'
import type { useBubblesRegistrationCoordinator } from './registration-coordinator'

interface ProviderMaintenanceOptions {
  isMountedRef: RefObject<boolean>;
  lifecycleVersionRef: RefObject<number>;
  appStateRef: RefObject<typeof AppState.currentState>;
  enrolledSessionRef: RefObject<EnrolledSession | null>;
  sessionSuspendedRef: RefObject<boolean>;
  currentDeviceIdRef: RefObject<string | null>;
  providerConfigurationRef: RefObject<BubblesProviderConfiguration>;
  pendingEnrollmentRef: RefObject<RegisterDeviceOptions | undefined | null>;
  pendingEnrollmentOperationsRef: RefObject<number>;
  registerDeviceRef: RefObject<RegisterDevice | null>;
  runRegistration: ReturnType<typeof useBubblesRegistrationCoordinator>['runRegistration'];
}

// Own scheduling without installing effects: the provider controls when ownership
// revocation, logout, and app-state transitions cancel each part of the work.
export function useBubblesProviderMaintenance ({
  isMountedRef,
  lifecycleVersionRef,
  appStateRef,
  enrolledSessionRef,
  sessionSuspendedRef,
  currentDeviceIdRef,
  providerConfigurationRef,
  pendingEnrollmentRef,
  pendingEnrollmentOperationsRef,
  registerDeviceRef,
  runRegistration
}: ProviderMaintenanceOptions) {
  const logoutRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestMaintenanceRef = useRef<() => void>(() => undefined)
  const maintenancePendingRef = useRef(false)
  const maintenanceRequestedRef = useRef(false)

  const maintainEnrolledSession = useCallback(async () => {
    const lifecycleVersion = lifecycleVersionRef.current
    const isCurrent = () => isMountedRef.current && lifecycleVersionRef.current === lifecycleVersion
    let runtimeStateUpdate

    do {
      maintenanceRequestedRef.current = false
      const enrolledSession = enrolledSessionRef.current

      if (sessionSuspendedRef.current || enrolledSession === null) {
        break
      }

      const maintenanceResult = await maintainBubblesDevice({
        oneSignalMigration: providerConfigurationRef.current.oneSignalMigration,
        isCurrent: () => isCurrent() && enrolledSessionRef.current === enrolledSession,
        appId: enrolledSession.appId,
        appKey: enrolledSession.appKey,
        apiBaseUrl: enrolledSession.apiBaseUrl,
        userId: enrolledSession.userId,
        aliasing: enrolledSession.aliasing,
        appVersion: enrolledSession.appVersion,
        deviceId: enrolledSession.deviceId,
        previousRegistrationState:
          enrolledSession.registrationState
      })

      if (!isCurrent() || enrolledSessionRef.current !== enrolledSession) {
        break
      }

      const nextDeviceId =
        maintenanceResult.syncResult?.deviceId ??
        enrolledSession.deviceId

      enrolledSessionRef.current = {
        ...enrolledSession,
        deviceId: nextDeviceId,
        registrationState: maintenanceResult.registrationState
      }
      currentDeviceIdRef.current = nextDeviceId
      runtimeStateUpdate = maintenanceResult.syncResult
        ? getRuntimeStateUpdate(maintenanceResult.syncResult)
        : {
          deviceId: nextDeviceId,
          pushToken: maintenanceResult.registrationState.token,
          tokenType: maintenanceResult.registrationState.tokenType,
          permissionStatus:
              maintenanceResult.registrationState.permissionStatus,
          notificationsEnabled:
              maintenanceResult.registrationState.notificationsEnabled
        }
    } while (maintenanceRequestedRef.current)

    return sessionSuspendedRef.current && runtimeStateUpdate
      ? { ...runtimeStateUpdate, notificationsEnabled: false }
      : runtimeStateUpdate
  }, [isMountedRef, lifecycleVersionRef, enrolledSessionRef, sessionSuspendedRef, providerConfigurationRef, currentDeviceIdRef])

  const clearLogoutRetry = useCallback(() => {
    if (logoutRetryTimerRef.current !== null) {
      clearTimeout(logoutRetryTimerRef.current)
      logoutRetryTimerRef.current = null
    }
  }, [])

  const scheduleLogoutRetry = useCallback(() => {
    if (!isMountedRef.current || appStateRef.current !== 'active' || logoutRetryTimerRef.current !== null) return
    logoutRetryTimerRef.current = setTimeout(() => {
      logoutRetryTimerRef.current = null
      requestMaintenanceRef.current()
    }, 15000)
  }, [isMountedRef, appStateRef])

  const requestMaintenance = useCallback(function requestMaintenance () {
    if (!isMountedRef.current) return
    const lifecycleVersion = lifecycleVersionRef.current
    const isCurrent = () => isMountedRef.current && lifecycleVersionRef.current === lifecycleVersion

    if (sessionSuspendedRef.current || enrolledSessionRef.current === null) {
      if (maintenancePendingRef.current) return
      maintenancePendingRef.current = true
      void runRegistration(async () => {
        await retryBubblesLogout(providerConfigurationRef.current)

        if (!isCurrent()) return
        if (sessionSuspendedRef.current) return { notificationsEnabled: false }

        return maintainEnrolledSession()
      }).then(() => {
        if (!isCurrent()) return
        clearLogoutRetry()
        const pending = pendingEnrollmentRef.current

        if (pending !== null && pendingEnrollmentOperationsRef.current === 0) {
          void registerDeviceRef.current?.(pending as RegisterDeviceOptions).catch(scheduleLogoutRetry)
        }
      }).catch(() => { if (isCurrent()) scheduleLogoutRetry() }).finally(() => {
        if (isCurrent()) maintenancePendingRef.current = false
      })

      return
    }

    maintenanceRequestedRef.current = true

    if (maintenancePendingRef.current) {
      return
    }

    maintenancePendingRef.current = true

    void Promise.resolve().then(() => {
      if (!isCurrent()) return
      void runRegistration(async () => maintainEnrolledSession())
        .catch(() => undefined)
        .finally(() => {
          if (!isCurrent()) return
          maintenancePendingRef.current = false

          if (maintenanceRequestedRef.current) {
            requestMaintenance()
          }
        })
    })
  }, [runRegistration, clearLogoutRetry, scheduleLogoutRetry, isMountedRef, maintainEnrolledSession, lifecycleVersionRef, sessionSuspendedRef, enrolledSessionRef, providerConfigurationRef, pendingEnrollmentRef, pendingEnrollmentOperationsRef, registerDeviceRef])

  const resetPendingMaintenance = useCallback(() => {
    maintenancePendingRef.current = false
  }, [])

  const clearRequestedMaintenance = useCallback(() => {
    maintenanceRequestedRef.current = false
  }, [])

  return {
    requestMaintenanceRef,
    requestMaintenance,
    clearLogoutRetry,
    scheduleLogoutRetry,
    resetPendingMaintenance,
    clearRequestedMaintenance
  }
}
