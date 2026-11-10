import { markBubblesLogout, retryBubblesLogout } from './logout'
import { getOrCreateInstallationId } from '../storage/installation-id'
import { normalizeSubscriptionId, type OneSignalMigration } from './migration'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { failWithBubblesError } from '../internal/errors'
import { getRequiredNonEmptyString } from '../internal/validation'
import { flushStoredBubblesDeliveryStatuses } from '../notifications/delivery-status'
import {
  readStoredDeviceIdAsync,
  prepareRegistrationScope,
  type StoredDeviceState
} from '../storage/device-state'
import {
  updateBubblesDeviceAttributes,
  type BubblesDeviceAttributes,
  type BubblesDeviceAttributeValue
} from '../api/device-client'

import {
  BubblesNotificationsContext,
  type BubblesNotificationsProviderProps,
  type RegisterDevice,
  type RegisterDeviceOptions
} from './context'
import {
  acquireBubblesForegroundPresentation,
  describeNotificationPermissionStatus,
  getNotificationPermissions,
  isNotificationPermissionGranted,
  observeBubblesNotificationOpenEvents,
  updateBubblesForegroundPresentation
} from './presentation'
import { maintainBubblesDevice, registerBubblesDevice } from './register-device'
import { enqueueBubblesRegistration, useBubblesRegistrationCoordinator } from './registration-coordinator'
import {
  areBubblesProviderConfigurationsCompatible as areProviderConfigurationsEqual,
  type BubblesProviderConfiguration as ProviderConfiguration
} from './provider-ownership'
import { useBubblesProviderLifecycle } from './provider-lifecycle'
import { createEnrollmentState, type EnrollmentRequest } from './enrollment-state'
import { createMaintenanceState } from './maintenance-state'
import {
  getInitialRuntimeState,
  getRuntimeStateUpdate,
  normalizeProviderError,
  normalizeUserId,
  type EnrolledSession
} from './provider-state'
import {
  observeBubblesDeviceTokenRefresh,
  observeBubblesForegroundRemoteMessages
} from './transport'

async function flushStoredDeliveryStatusesBestEffort (
  source: string,
  storedDeviceState?: StoredDeviceState
): Promise<void> {
  try {
    await flushStoredBubblesDeliveryStatuses(storedDeviceState)
  } catch (error) {
    console.error(
      `[@fishonfire/bubbles-expo] Failed to flush stored delivery statuses ${source}.`,
      error
    )
  }
}

function hasRequiredMigrationIdentity (
  storedDeviceState: StoredDeviceState,
  migrationPolicy: OneSignalMigration['policy']
): boolean {
  return migrationPolicy !== 'required' || !!storedDeviceState.oneSignalSubscriptionId
}

function isSameEnrolledSession (
  previousSession: EnrolledSession | null,
  nextSession: ProviderConfiguration & {
    deviceId: string | null;
    userId: string;
    appVersion?: string | null;
    aliasing?: string[] | null;
  }
): previousSession is EnrolledSession {
  return previousSession !== null &&
    areProviderConfigurationsEqual(previousSession, nextSession) &&
    previousSession.deviceId === nextSession.deviceId &&
    previousSession.userId === nextSession.userId &&
    (previousSession.appVersion ?? null) === (nextSession.appVersion ?? null) &&
    JSON.stringify(previousSession.aliasing ?? []) === JSON.stringify(nextSession.aliasing ?? [])
}

function getEnrollmentUserId (
  options: RegisterDeviceOptions | undefined,
  ready: boolean | undefined,
  userId: string | null | undefined
): string {
  const usesLegacyEnrollment = options === undefined

  if (usesLegacyEnrollment && !ready) {
    failWithBubblesError(
      'The deprecated zero-argument "registerDevice()" call requires the provider "ready" prop to be true.'
    )
  }

  const enrollmentUserId = usesLegacyEnrollment
    ? normalizeUserId(userId ?? null)
    : normalizeUserId(options?.userId)

  if (enrollmentUserId === null) {
    failWithBubblesError(
      '"registerDevice(options)" requires a non-empty "userId".'
    )
  }

  return enrollmentUserId
}

export function BubblesNotificationsProvider (
  props: BubblesNotificationsProviderProps
) {
  const {
    appId,
    appKey,
    apiBaseUrl,
    oneSignalMigration,
    ready,
    userId,
    aliasing,
    appVersion,
    onLogout,
    foregroundPresentation,
    onNotificationResponse,
    children
  } = props
  const migrationPolicy = oneSignalMigration?.policy ?? 'disabled'
  const migrationBridge = oneSignalMigration?.policy === 'required' ? oneSignalMigration.bridge : undefined
  const migrationAppId = oneSignalMigration?.policy === 'required' ? oneSignalMigration.oneSignalAppId : undefined
  const migrationTimeout = oneSignalMigration?.policy === 'required' ? (oneSignalMigration.readinessTimeoutMs ?? 3000) : undefined
  const stableMigration = useMemo(() => migrationPolicy === 'required' && migrationBridge && migrationAppId !== undefined
    ? { policy: 'required' as const, bridge: migrationBridge, oneSignalAppId: migrationAppId, readinessTimeoutMs: migrationTimeout }
    : undefined, [migrationPolicy, migrationBridge, migrationAppId, migrationTimeout])
  const normalizedUserId = normalizeUserId(userId ?? null)
  const [state, setState] = useState(getInitialRuntimeState)
  const lifecycle = useBubblesProviderLifecycle()
  const {
    isMountedRef,
    captureCurrentLifecycle,
    acquireOwnership,
    providerOwnerRef,
    ownershipEpoch,
    observeCurrentProvider,
    isCurrentProvider,
    assertCurrentProvider,
    assertProviderOwnership,
    runOwnedLogout
  } = lifecycle
  const {
    runRegistration,
    waitForCurrentRegistration
  } = useBubblesRegistrationCoordinator(setState, lifecycle)
  const currentDeviceIdRef = useRef<string | null>(state.deviceId)
  const previousUserIdRef = useRef<string | null>(normalizedUserId)
  const [enrollment] = useState(createEnrollmentState)
  const [maintenance] = useState(createMaintenanceState)
  const desiredOperationRef = useRef(0)
  const enrollmentRequestVersionRef = useRef(0)
  const providerConfigurationVersionRef = useRef(0)
  const providerConfigurationRef = useRef<ProviderConfiguration>({
    appId,
    appKey,
    apiBaseUrl,
    oneSignalMigration
  })
  const appStateRef = useRef(AppState.currentState)

  useLayoutEffect(() => {
    const providerConfiguration = { appId, appKey, apiBaseUrl, oneSignalMigration: stableMigration }

    if (!areProviderConfigurationsEqual(
      providerConfigurationRef.current,
      providerConfiguration
    )) {
      providerConfigurationRef.current = providerConfiguration
      providerConfigurationVersionRef.current += 1
      enrollmentRequestVersionRef.current += 1
      enrollment.reset()
      currentDeviceIdRef.current = null
    }
  }, [appId, appKey, apiBaseUrl, stableMigration, enrollment])

  useLayoutEffect(() => {
    enrollment.commitLegacyInputs({ ready, userId: normalizedUserId, aliasing, appVersion })
  }, [enrollment, ready, normalizedUserId, aliasing, appVersion])

  const logoutRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const maintainEnrolledSession = useCallback(async () => {
    const isCurrent = captureCurrentLifecycle()
    let runtimeStateUpdate

    do {
      maintenance.beginPass()
      const enrolledSession = enrollment.getSession()

      if (enrollment.isSuspended() || enrolledSession === null) {
        break
      }

      const maintenanceResult = await maintainBubblesDevice({
        oneSignalMigration: providerConfigurationRef.current.oneSignalMigration,
        isCurrent: () => isCurrent() && enrollment.getSession() === enrolledSession,
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

      if (!isCurrent() || enrollment.getSession() !== enrolledSession) {
        break
      }

      const nextDeviceId =
        maintenanceResult.syncResult?.deviceId ??
        enrolledSession.deviceId

      enrollment.setSession({
        ...enrolledSession,
        deviceId: nextDeviceId,
        registrationState: maintenanceResult.registrationState
      })
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
    } while (maintenance.needsRerun)

    return enrollment.isSuspended() && runtimeStateUpdate
      ? { ...runtimeStateUpdate, notificationsEnabled: false }
      : runtimeStateUpdate
  }, [captureCurrentLifecycle, enrollment, maintenance])

  const clearLogoutRetry = useCallback(() => {
    if (logoutRetryTimerRef.current !== null) {
      clearTimeout(logoutRetryTimerRef.current)
      logoutRetryTimerRef.current = null
    }
  }, [])

  const scheduleLogoutRetry = useCallback((retry: () => void) => {
    if (!isMountedRef.current || appStateRef.current !== 'active' || logoutRetryTimerRef.current !== null) return
    logoutRetryTimerRef.current = setTimeout(() => {
      logoutRetryTimerRef.current = null
      retry()
    }, 15000)
  }, [isMountedRef])

  const isCurrentEnrollmentRequest = useCallback((
    requestVersion: number,
    providerConfigurationVersion: number
  ): boolean => isMountedRef.current && requestVersion === enrollmentRequestVersionRef.current &&
      providerConfigurationVersion === providerConfigurationVersionRef.current, [isMountedRef])

  const enrollDevice = useCallback(async (
    request: EnrollmentRequest,
    previousSession: EnrolledSession | null,
    providerConfiguration: ProviderConfiguration,
    requestVersion: number,
    providerConfigurationVersion: number
  ) => {
    if (
      !isCurrentEnrollmentRequest(requestVersion, providerConfigurationVersion)
    ) {
      return
    }

    const usesLegacyEnrollment = request.kind === 'legacy'
    const options = request.kind === 'explicit' ? request.options : undefined
    const { ready, userId, aliasing, appVersion } = enrollment.getLegacyInputs()
    const enrollmentUserId = getEnrollmentUserId(options, ready, userId)

    const enrollmentAliasing = usesLegacyEnrollment
      ? aliasing
      : options?.aliasing
    const enrollmentAppVersion = usesLegacyEnrollment
      ? appVersion
      : options?.appVersion

    const deviceId = currentDeviceIdRef.current
    const sameSession = isSameEnrolledSession(previousSession, {
      ...providerConfiguration,
      deviceId,
      userId: enrollmentUserId,
      appVersion: enrollmentAppVersion,
      aliasing: enrollmentAliasing
    })

    const result = await registerBubblesDevice({
      ...providerConfiguration,
      isCurrent: () => isCurrentEnrollmentRequest(requestVersion, providerConfigurationVersion),
      userId: enrollmentUserId,
      aliasing: enrollmentAliasing,
      appVersion: enrollmentAppVersion,
      deviceId,
      loadDeviceId:
        deviceId === null ? readStoredDeviceIdAsync : undefined,
      registrationOptions: options,
      ...(sameSession
        ? {
          previousRegistrationState: previousSession.registrationState
        }
        : {})
    })

    if (
      !isCurrentEnrollmentRequest(requestVersion, providerConfigurationVersion)
    ) {
      return
    }

    enrollment.clearPending()
    currentDeviceIdRef.current = result.deviceId

    if (result.deviceId !== null) {
      enrollment.setSession({
        ...providerConfiguration,
        userId: enrollmentUserId,
        aliasing: enrollmentAliasing ? [...enrollmentAliasing] : enrollmentAliasing,
        appVersion: enrollmentAppVersion,
        deviceId: result.deviceId,
        registrationState: result.registrationState,
        source: usesLegacyEnrollment ? 'legacy' : 'explicit'
      })
    }

    return getRuntimeStateUpdate(result)
  }, [enrollment, isCurrentEnrollmentRequest])

  const startEnrollment = useCallback(async (request: EnrollmentRequest, onRetryNeeded: () => void): Promise<void> => {
    // Reserve call order before waiting, so a later logout still supersedes
    // enrollment requested by a descendant before ownership acquisition.
    const operationId = ++desiredOperationRef.current

    if (!isCurrentProvider()) await Promise.resolve()
    assertProviderOwnership('Registration')
    if (operationId !== desiredOperationRef.current) return
    const providerConfiguration = providerConfigurationRef.current
    const providerConfigurationVersion = providerConfigurationVersionRef.current
    const isCurrentOperation = () => operationId === desiredOperationRef.current &&
      providerConfigurationVersion === providerConfigurationVersionRef.current

    const finishEnrollment = enrollment.begin(request)

    return runRegistration(async () => {
      if (!isCurrentOperation()) return
      enrollment.setPending(request)
      await retryBubblesLogout(providerConfiguration)
      if (!isCurrentOperation()) return
      clearLogoutRetry()
      const requestVersion = ++enrollmentRequestVersionRef.current
      const previousSession = enrollment.getSession()

      enrollment.clearSession()
      const result = await enrollDevice(request, previousSession, providerConfiguration,
        requestVersion, providerConfigurationVersion)

      if (isCurrentOperation() && enrollment.getSession() !== null) {
        enrollment.resume()
      }

      return enrollment.isSuspended() && result ? { ...result, notificationsEnabled: false } : result
    }).catch((error) => {
      if (operationId === desiredOperationRef.current) onRetryNeeded()
      throw error
    }).finally(finishEnrollment)
  }, [isCurrentProvider, assertProviderOwnership, enrollment, runRegistration, clearLogoutRetry, enrollDevice])

  const requestMaintenance = useCallback(function requestMaintenance () {
    if (!isMountedRef.current) return
    const isCurrent = captureCurrentLifecycle()

    if (enrollment.isSuspended() || enrollment.getSession() === null) {
      if (!maintenance.start()) return
      void runRegistration(async () => {
        await retryBubblesLogout(providerConfigurationRef.current)

        if (!isCurrent()) return
        if (enrollment.isSuspended()) return { notificationsEnabled: false }

        return maintainEnrolledSession()
      }).then(() => {
        if (!isCurrent()) return
        clearLogoutRetry()
        const pending = enrollment.getRetryRequest()

        if (pending) {
          void startEnrollment(pending, () => scheduleLogoutRetry(requestMaintenance))
            .catch(() => scheduleLogoutRetry(requestMaintenance))
        }
      }).catch(() => { if (isCurrent()) scheduleLogoutRetry(requestMaintenance) }).finally(() => {
        if (isCurrent()) maintenance.finish()
      })

      return
    }

    if (!maintenance.request()) return

    void Promise.resolve().then(() => {
      if (!isCurrent()) return
      void runRegistration(async () => maintainEnrolledSession())
        .catch(() => undefined)
        .finally(() => {
          if (!isCurrent()) return
          if (maintenance.finish()) {
            requestMaintenance()
          }
        })
    })
  }, [runRegistration, clearLogoutRetry, scheduleLogoutRetry, isMountedRef, maintainEnrolledSession, captureCurrentLifecycle, enrollment, maintenance, startEnrollment])

  const onOwnershipAcquired = useCallback(() => {
    setState((current) => current.notificationsEnabled && enrollment.isSuspended()
      ? { ...current, notificationsEnabled: false }
      : current)
  }, [enrollment])
  const onOwnershipRevoked = useCallback((retired: boolean) => {
    maintenance.reset()
    enrollmentRequestVersionRef.current += 1
    desiredOperationRef.current += 1
    // Suspense preserves the same owner's session and pending enrollment.
    // A successor must start its own explicit enrollment session.
    if (retired) {
      enrollment.reset()
    }
    clearLogoutRetry()
  }, [clearLogoutRetry, enrollment, maintenance])

  // Configuration invalidation above must commit before ownership acquisition;
  // notification subscriptions below retain their original passive ordering.
  useLayoutEffect(() => acquireOwnership(
    { appId, appKey, apiBaseUrl, oneSignalMigration: stableMigration },
    onOwnershipRevoked,
    onOwnershipAcquired
  ), [acquireOwnership, appId, appKey, apiBaseUrl, stableMigration, onOwnershipRevoked, onOwnershipAcquired])

  useEffect(() => observeCurrentProvider(() => acquireBubblesForegroundPresentation(
    providerOwnerRef.current
  )), [observeCurrentProvider, providerOwnerRef, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch])

  useEffect(() => {
    currentDeviceIdRef.current = state.deviceId
  }, [state.deviceId])

  useEffect(() => {
    let isCancelled = false
    const isCurrentLifecycle = captureCurrentLifecycle()
    const isCurrent = () => !isCancelled && isCurrentLifecycle()

    void enqueueBubblesRegistration(async () => {
      if (!isCurrent()) return
      try {
        const [storedDeviceState, permissions] = await Promise.all([
          (async () => {
            const installationId = await getOrCreateInstallationId()
            const scopedState = await prepareRegistrationScope(getRequiredNonEmptyString(apiBaseUrl, 'apiBaseUrl'), appId,
              getRequiredNonEmptyString(appKey, 'appKey'), isCurrent)

            return { ...scopedState, identityAcknowledged: scopedState.identityAcknowledged && scopedState.acknowledgedInstallationId === installationId }
          })(),
          getNotificationPermissions({ requestPermissions: false })
        ])

        if (!isCurrent()) {
          return
        }

        currentDeviceIdRef.current = storedDeviceState.deviceId
        setState((currentState) => ({
          ...currentState,
          deviceId: storedDeviceState.deviceId,
          permissionStatus:
            describeNotificationPermissionStatus(permissions),
          notificationsEnabled:
            !enrollment.isSuspended() && isNotificationPermissionGranted(permissions),
          error: null
        }))

        if (
          storedDeviceState.identityAcknowledged &&
          hasRequiredMigrationIdentity(storedDeviceState, migrationPolicy) &&
          storedDeviceState.deviceId &&
          storedDeviceState.apiBaseUrl &&
          storedDeviceState.appKey
        ) {
          void flushStoredDeliveryStatusesBestEffort(
            'during provider startup',
            storedDeviceState
          )
        }
        requestMaintenance()
      } catch (error) {
        if (isCurrent()) {
          setState((currentState) => ({
            ...currentState,
            error: normalizeProviderError(error)
          }))
        }
      }
    })

    return () => {
      isCancelled = true
    }
  }, [appId, apiBaseUrl, appKey, migrationPolicy, stableMigration, captureCurrentLifecycle, ownershipEpoch, requestMaintenance, enrollment])

  useEffect(() => {
    updateBubblesForegroundPresentation(
      providerOwnerRef.current,
      foregroundPresentation
    )
  }, [foregroundPresentation, providerOwnerRef, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch])

  useEffect(() => observeCurrentProvider(observeBubblesForegroundRemoteMessages), [observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch])

  useEffect(() => observeCurrentProvider(() => observeBubblesDeviceTokenRefresh(() => {
    requestMaintenance()
  })), [requestMaintenance, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch])

  useEffect(() => observeCurrentProvider(() => {
    if (!migrationBridge) return
    let active = true
    const unsubscribe = migrationBridge.subscribe((id) => {
      if (!active) return
      const normalized = normalizeSubscriptionId(id)
      const accepted = enrollment.getSession()?.registrationState.oneSignalSubscriptionId

      if (normalized && accepted && normalized !== accepted) {
        setState((current) => ({ ...current, error: new Error('OneSignal subscription changed; identity requires reconciliation.') }))

        return
      }
      if (normalized) requestMaintenance()
    })

    return () => { active = false; unsubscribe() }
  }), [migrationBridge, requestMaintenance, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch, enrollment])
  useEffect(() => observeCurrentProvider(() => {
    appStateRef.current = AppState.currentState
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState) => {
        if (!isMountedRef.current) return
        const previousAppState = appStateRef.current

        appStateRef.current = nextAppState
        if (nextAppState !== 'active') clearLogoutRetry()

        if (previousAppState !== 'active' && nextAppState === 'active') {
          if (enrollment.getSession()) void flushStoredDeliveryStatusesBestEffort(
            'after the app returned to the foreground'
          )
          requestMaintenance()
        }
      }
    )

    return () => {
      subscription.remove()
    }
  }), [requestMaintenance, clearLogoutRetry, observeCurrentProvider, isMountedRef, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch, enrollment])

  useEffect(() => observeCurrentProvider(() => observeBubblesNotificationOpenEvents({
    onNotificationResponse
  })), [onNotificationResponse, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration, ownershipEpoch])

  useEffect(() => {
    if (!isMountedRef.current) return
    const isCurrent = captureCurrentLifecycle()
    const previousUserId = previousUserIdRef.current

    if (previousUserId !== null && normalizedUserId === null) {
      if (enrollment.getSession()?.source === 'legacy') {
        enrollment.clearSession()
      }

      if (onLogout) {
        void Promise.resolve()
          .then(() => {
            if (isCurrent()) return onLogout({ previousUserId, deviceId: state.deviceId })
          })
          .catch((error) => {
            console.error(
              '[@fishonfire/bubbles-expo] Deprecated onLogout callback failed.',
              error
            )
          })
      }
    }

    previousUserIdRef.current = normalizedUserId
  }, [normalizedUserId, onLogout, state.deviceId, isMountedRef, captureCurrentLifecycle, enrollment])

  const registerDevice: RegisterDevice = (options?: RegisterDeviceOptions) => startEnrollment(
    options === undefined ? { kind: 'legacy' } : { kind: 'explicit', options },
    () => scheduleLogoutRetry(requestMaintenance)
  )

  async function logout (): Promise<void> {
    const operationId = ++desiredOperationRef.current

    return runOwnedLogout(() => beginLogout(operationId))
  }

  function beginLogout (operationId: number): Promise<void> {
    assertProviderOwnership('Logout')
    const configuration = providerConfigurationRef.current
    const isCurrent = captureCurrentLifecycle()

    enrollment.suspend()
    enrollment.clearPending()
    maintenance.clearRerun()
    clearLogoutRetry()
    setState((current) => ({ ...current, notificationsEnabled: false }))
    const deviceId = currentDeviceIdRef.current
    const marked = markBubblesLogout(configuration, deviceId)
    // Observe rejection immediately while the registration queue is draining.
    const markResult = marked.then(() => ({ error: null }), (error: unknown) => ({ error }))

    return runRegistration(async () => {
      enrollment.clearSession()
      if (isCurrent()) {
        enrollmentRequestVersionRef.current += 1
        setState((current) => ({ ...current, notificationsEnabled: false }))
        if (operationId === desiredOperationRef.current) enrollment.clearPending()
        maintenance.clearRerun()
      }
      const result = await markResult

      if (result.error !== null) throw result.error
      await retryBubblesLogout(configuration)
      if (isCurrent()) {
        clearLogoutRetry()
        setState((current) => ({ ...current, notificationsEnabled: false }))
      }
    }, { durable: true }).catch((error) => {
      if (isCurrent()) scheduleLogoutRetry(requestMaintenance)
      throw error
    })
  }

  function setDeviceAttributes (attributes: BubblesDeviceAttributes) {
    return updateDeviceAttributes(() => attributes, 'setDeviceAttributes')
  }

  function updateDeviceAttributes (
    getAttributes: () => BubblesDeviceAttributes,
    operationName: 'addDeviceAttribute' | 'setDeviceAttributes'
  ) {
    return (async () => {
      await waitForCurrentRegistration()
      assertCurrentProvider()
      const attributes = getAttributes()

      const deviceId = enrollment.getSession()?.deviceId ?? null

      if (deviceId === null) {
        failWithBubblesError(
          `"${operationName}()" requires a backend "deviceId" before attributes can be synced.`
        )
      }

      await updateBubblesDeviceAttributes({
        apiBaseUrl: providerConfigurationRef.current.apiBaseUrl,
        appKey: providerConfigurationRef.current.appKey,
        deviceId,
        attributes
      })
    })().catch((error) => {
      const normalizedError = normalizeProviderError(error)

      if (isMountedRef.current) {
        setState((currentState) => ({
          ...currentState,
          error: normalizedError
        }))
      }

      throw normalizedError
    })
  }

  function addDeviceAttribute (
    name: string,
    value: BubblesDeviceAttributeValue
  ) {
    return updateDeviceAttributes(() => {
      const attributeName = getRequiredNonEmptyString(name, 'attributeName')

      if (value === undefined) {
        failWithBubblesError(
          '"addDeviceAttribute()" requires "value" to be a JSON-compatible value.'
        )
      }

      return {
        [attributeName]: value
      }
    }, 'addDeviceAttribute')
  }

  const contextValue = {
    logout,
    registerDevice,
    setDeviceAttributes,
    addDeviceAttribute,
    notificationsEnabled: state.notificationsEnabled,
    isSyncing: state.isSyncing,
    error: state.error
  }

  return (
    <BubblesNotificationsContext.Provider value={contextValue}>
      {children}
    </BubblesNotificationsContext.Provider>
  )
}
