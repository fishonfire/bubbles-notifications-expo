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
import {
  maintainBubblesDevice,
  registerBubblesDevice,
  type RegisterBubblesDeviceResult
} from './register-device'
import { enqueueBubblesRegistration, useBubblesRegistrationCoordinator } from './registration-coordinator'
import {
  acquireBubblesProviderOwnership,
  areBubblesProviderConfigurationsCompatible as areProviderConfigurationsEqual,
  isCurrentBubblesProvider,
  isRetiredBubblesProvider,
  type BubblesProviderConfiguration as ProviderConfiguration
} from './provider-ownership'
import { createLogoutOwnershipGate } from './logout-ownership'
import {
  getInitialRuntimeState,
  getRuntimeStateUpdate,
  normalizeProviderError,
  normalizeUserId
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

interface EnrolledSession extends ProviderConfiguration {
  userId: string;
  aliasing?: string[] | null;
  appVersion?: string | null;
  deviceId: string;
  registrationState: RegisterBubblesDeviceResult['registrationState'];
  source: 'explicit' | 'legacy';
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
  const {
    isMountedRef,
    invalidateRegistrations,
    runRegistration,
    waitForCurrentRegistration
  } = useBubblesRegistrationCoordinator(setState)
  const currentDeviceIdRef = useRef<string | null>(state.deviceId)
  const providerOwnerRef = useRef({})
  const logoutOwnershipRef = useRef(createLogoutOwnershipGate())
  const lifecycleVersionRef = useRef(0)
  const listenerCleanupsRef = useRef(new Set<() => void>())
  const observeCurrentProvider = useCallback((observe: () => (() => void) | undefined) => {
    if (!isCurrentBubblesProvider(providerOwnerRef.current)) return
    const cleanup = observe()

    if (!cleanup) return
    let active = true
    const release = () => {
      if (!active) return
      active = false
      listenerCleanupsRef.current.delete(release)
      cleanup()
    }

    listenerCleanupsRef.current.add(release)

    return release
  }, [])
  const previousUserIdRef = useRef<string | null>(normalizedUserId)
  const enrolledSessionRef = useRef<EnrolledSession | null>(null)
  const sessionSuspendedRef = useRef(true)
  const desiredOperationRef = useRef(0)
  const pendingEnrollmentOperationsRef = useRef(0)
  const logoutRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestMaintenanceRef = useRef<() => void>(() => undefined)
  const enrollmentRequestVersionRef = useRef(0)
  const providerConfigurationVersionRef = useRef(0)
  const providerConfigurationRef = useRef<ProviderConfiguration>({
    appId,
    appKey,
    apiBaseUrl,
    oneSignalMigration
  })
  const pendingEnrollmentRef = useRef<RegisterDeviceOptions | undefined | null>(null)
  const registerDeviceRef = useRef<RegisterDevice | null>(null)
  const maintenancePendingRef = useRef(false)
  const maintenanceRequestedRef = useRef(false)
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
      enrolledSessionRef.current = null
      sessionSuspendedRef.current = true
      currentDeviceIdRef.current = null
      pendingEnrollmentRef.current = null
    }
  }, [appId, appKey, apiBaseUrl, stableMigration])

  const maintainEnrolledSession = useCallback(async () => {
    let runtimeStateUpdate

    do {
      maintenanceRequestedRef.current = false
      const enrolledSession = enrolledSessionRef.current

      if (sessionSuspendedRef.current || enrolledSession === null) {
        break
      }

      const maintenanceResult = await maintainBubblesDevice({
        oneSignalMigration: providerConfigurationRef.current.oneSignalMigration,
        isCurrent: () => isMountedRef.current && enrolledSessionRef.current === enrolledSession,
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

      if (!isMountedRef.current || enrolledSessionRef.current !== enrolledSession) {
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
  }, [isMountedRef])

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
  }, [isMountedRef])

  const requestMaintenance = useCallback(() => {
    if (!isMountedRef.current) return
    const lifecycleVersion = lifecycleVersionRef.current
    const isCurrent = () => isMountedRef.current && lifecycleVersionRef.current === lifecycleVersion

    if (sessionSuspendedRef.current || enrolledSessionRef.current === null) {
      if (maintenancePendingRef.current) return
      maintenancePendingRef.current = true
      void runRegistration(async () => {
        await retryBubblesLogout(providerConfigurationRef.current)

        if (!isCurrent()) return
        if (sessionSuspendedRef.current) {
          return { notificationsEnabled: false }
        } else {
          return maintainEnrolledSession()
        }
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
  }, [runRegistration, clearLogoutRetry, scheduleLogoutRetry, isMountedRef, maintainEnrolledSession])

  requestMaintenanceRef.current = requestMaintenance

  useLayoutEffect(() => {
    const owner = providerOwnerRef.current

    if (isRetiredBubblesProvider(owner)) return
    const revoke = () => {
      isMountedRef.current = false
      lifecycleVersionRef.current += 1
      maintenancePendingRef.current = false
      invalidateRegistrations()
      enrollmentRequestVersionRef.current += 1
      desiredOperationRef.current += 1
      enrolledSessionRef.current = null
      sessionSuspendedRef.current = true
      pendingEnrollmentRef.current = null
      maintenanceRequestedRef.current = false
      clearLogoutRetry()
      for (const cleanup of [...listenerCleanupsRef.current]) cleanup()
    }
    let release: () => void

    try {
      release = acquireBubblesProviderOwnership(owner,
        { appId, appKey, apiBaseUrl, oneSignalMigration: stableMigration }, revoke)
    } catch (error) {
      // Child layout effects run first and may already have queued enrollment.
      // A failed acquisition has no React cleanup, so retire that work now.
      revoke()
      logoutOwnershipRef.current.flushPending()
      throw error
    }

    logoutOwnershipRef.current.acceptOwnership()
    isMountedRef.current = true
    setState((current) => current.notificationsEnabled
      ? { ...current, notificationsEnabled: false }
      : current)

    return release
  }, [appId, appKey, apiBaseUrl, stableMigration, isMountedRef, invalidateRegistrations, clearLogoutRetry])

  useEffect(() => observeCurrentProvider(() => acquireBubblesForegroundPresentation(
    providerOwnerRef.current
  )), [observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => {
    currentDeviceIdRef.current = state.deviceId
  }, [state.deviceId])

  useEffect(() => {
    let isCancelled = false

    void enqueueBubblesRegistration(async () => {
      if (isCancelled || !isMountedRef.current) return
      try {
        const [storedDeviceState, permissions] = await Promise.all([
          (async () => {
            const installationId = await getOrCreateInstallationId()
            const scopedState = await prepareRegistrationScope(getRequiredNonEmptyString(apiBaseUrl, 'apiBaseUrl'), appId,
              getRequiredNonEmptyString(appKey, 'appKey'), () => !isCancelled && isMountedRef.current)

            return { ...scopedState, identityAcknowledged: scopedState.identityAcknowledged && scopedState.acknowledgedInstallationId === installationId }
          })(),
          getNotificationPermissions({ requestPermissions: false })
        ])

        if (isCancelled || !isMountedRef.current) {
          return
        }

        currentDeviceIdRef.current = storedDeviceState.deviceId
        setState((currentState) => ({
          ...currentState,
          deviceId: storedDeviceState.deviceId,
          permissionStatus:
            describeNotificationPermissionStatus(permissions),
          notificationsEnabled:
            !sessionSuspendedRef.current && isNotificationPermissionGranted(permissions),
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
        requestMaintenanceRef.current()
      } catch (error) {
        if (!isCancelled && isMountedRef.current) {
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
  }, [appId, apiBaseUrl, appKey, migrationPolicy, stableMigration, isMountedRef])

  useEffect(() => {
    updateBubblesForegroundPresentation(
      providerOwnerRef.current,
      foregroundPresentation
    )
  }, [foregroundPresentation, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => observeCurrentProvider(observeBubblesForegroundRemoteMessages), [observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => observeCurrentProvider(() => observeBubblesDeviceTokenRefresh(() => {
    requestMaintenance()
  })), [requestMaintenance, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => observeCurrentProvider(() => {
    if (!migrationBridge) return
    let active = true
    const unsubscribe = migrationBridge.subscribe((id) => {
      if (!active) return
      const normalized = normalizeSubscriptionId(id)
      const accepted = enrolledSessionRef.current?.registrationState.oneSignalSubscriptionId

      if (normalized && accepted && normalized !== accepted) {
        setState((current) => ({ ...current, error: new Error('OneSignal subscription changed; identity requires reconciliation.') }))

        return
      }
      if (normalized) requestMaintenance()
    })

    return () => { active = false; unsubscribe() }
  }), [migrationBridge, requestMaintenance, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration])
  useEffect(() => observeCurrentProvider(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextAppState) => {
        if (!isMountedRef.current) return
        const previousAppState = appStateRef.current

        appStateRef.current = nextAppState
        if (nextAppState !== 'active') clearLogoutRetry()

        if (previousAppState !== 'active' && nextAppState === 'active') {
          if (enrolledSessionRef.current) void flushStoredDeliveryStatusesBestEffort(
            'after the app returned to the foreground'
          )
          requestMaintenance()
        }
      }
    )

    return () => {
      subscription.remove()
    }
  }), [requestMaintenance, clearLogoutRetry, observeCurrentProvider, isMountedRef, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => observeCurrentProvider(() => observeBubblesNotificationOpenEvents({
    onNotificationResponse
  })), [onNotificationResponse, observeCurrentProvider, appId, appKey, apiBaseUrl, stableMigration])

  useEffect(() => {
    if (!isMountedRef.current) return
    const lifecycleVersion = lifecycleVersionRef.current
    const previousUserId = previousUserIdRef.current

    if (previousUserId !== null && normalizedUserId === null) {
      if (enrolledSessionRef.current?.source === 'legacy') {
        enrolledSessionRef.current = null
      }

      if (onLogout) {
        void Promise.resolve()
          .then(() => {
            if (isMountedRef.current && lifecycleVersionRef.current === lifecycleVersion) return onLogout({ previousUserId, deviceId: state.deviceId })
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
  }, [normalizedUserId, onLogout, state.deviceId, isMountedRef])

  function assertCurrentProvider () {
    if (!isMountedRef.current) failWithBubblesError('This BubblesNotificationsProvider has been replaced or unmounted.')
  }

  const registerDevice: RegisterDevice = async (options?: RegisterDeviceOptions) => {
    // Reserve call order before waiting, so a later logout still supersedes
    // enrollment requested by a descendant before ownership acquisition.
    const operationId = ++desiredOperationRef.current

    if (!isCurrentBubblesProvider(providerOwnerRef.current)) await Promise.resolve()
    assertCurrentProvider()
    if (!isCurrentBubblesProvider(providerOwnerRef.current)) {
      failWithBubblesError('Registration requires successful BubblesNotificationsProvider ownership acquisition.')
    }
    if (operationId !== desiredOperationRef.current) return
    const providerConfiguration = providerConfigurationRef.current
    const providerConfigurationVersion = providerConfigurationVersionRef.current
    const isCurrentOperation = () => operationId === desiredOperationRef.current &&
      providerConfigurationVersion === providerConfigurationVersionRef.current

    sessionSuspendedRef.current = true
    pendingEnrollmentRef.current = options
    pendingEnrollmentOperationsRef.current += 1

    return runRegistration(async () => {
      if (!isCurrentOperation()) return
      pendingEnrollmentRef.current = options
      await retryBubblesLogout(providerConfiguration)
      if (!isCurrentOperation()) return
      clearLogoutRetry()
      const requestVersion = ++enrollmentRequestVersionRef.current
      const previousSession = enrolledSessionRef.current

      enrolledSessionRef.current = null
      const result = await enrollDevice(options, previousSession, providerConfiguration,
        requestVersion, providerConfigurationVersion)

      if (isCurrentOperation() && enrolledSessionRef.current !== null) {
        sessionSuspendedRef.current = false
      }

      return sessionSuspendedRef.current && result ? { ...result, notificationsEnabled: false } : result
    }).catch((error) => {
      if (operationId === desiredOperationRef.current) scheduleLogoutRetry()
      throw error
    }).finally(() => { pendingEnrollmentOperationsRef.current -= 1 })
  }

  registerDeviceRef.current = registerDevice

  async function logout (): Promise<void> {
    assertCurrentProvider()
    const configuration = providerConfigurationRef.current
    const lifecycleVersion = lifecycleVersionRef.current
    const isCurrent = () => isMountedRef.current && lifecycleVersionRef.current === lifecycleVersion
    const operationId = ++desiredOperationRef.current

    sessionSuspendedRef.current = true
    pendingEnrollmentRef.current = null
    maintenanceRequestedRef.current = false
    clearLogoutRetry()
    setState((current) => ({ ...current, notificationsEnabled: false }))
    const deviceId = currentDeviceIdRef.current
    const marked = logoutOwnershipRef.current.markLogout(() => markBubblesLogout(configuration, deviceId))
    // Observe rejection immediately while the registration queue is draining.
    const markResult = marked.then(() => ({ error: null }), (error: unknown) => ({ error }))

    return runRegistration(async () => {
      if (isCurrent()) {
        enrollmentRequestVersionRef.current += 1
        enrolledSessionRef.current = null
        setState((current) => ({ ...current, notificationsEnabled: false }))
        if (operationId === desiredOperationRef.current) pendingEnrollmentRef.current = null
        maintenanceRequestedRef.current = false
      }
      const result = await markResult

      if (result.error !== null) throw result.error
      await retryBubblesLogout(configuration)
      if (isCurrent()) {
        clearLogoutRetry()
        setState((current) => ({ ...current, notificationsEnabled: false }))
      }
    }, { durable: true }).catch((error) => {
      if (isCurrent()) scheduleLogoutRetry()
      throw error
    })
  }

  function isCurrentEnrollmentRequest (
    requestVersion: number,
    providerConfigurationVersion: number
  ): boolean {
    return isMountedRef.current && requestVersion === enrollmentRequestVersionRef.current &&
      providerConfigurationVersion === providerConfigurationVersionRef.current
  }

  function getEnrollmentUserId (options: RegisterDeviceOptions | undefined): string {
    const usesLegacyEnrollment = options === undefined

    if (usesLegacyEnrollment && !ready) {
      failWithBubblesError(
        'The deprecated zero-argument "registerDevice()" call requires the provider "ready" prop to be true.'
      )
    }

    const enrollmentUserId = usesLegacyEnrollment
      ? normalizedUserId
      : normalizeUserId(options?.userId)

    if (enrollmentUserId === null) {
      failWithBubblesError(
        '"registerDevice(options)" requires a non-empty "userId".'
      )
    }

    return enrollmentUserId
  }

  async function enrollDevice (
    options: RegisterDeviceOptions | undefined,
    previousSession: EnrolledSession | null,
    providerConfiguration: ProviderConfiguration,
    requestVersion: number,
    providerConfigurationVersion: number
  ) {
    if (
      !isCurrentEnrollmentRequest(requestVersion, providerConfigurationVersion)
    ) {
      return
    }

    const usesLegacyEnrollment = options === undefined

    const enrollmentUserId = getEnrollmentUserId(options)

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

    pendingEnrollmentRef.current = null
    currentDeviceIdRef.current = result.deviceId

    if (result.deviceId !== null) {
      enrolledSessionRef.current = {
        ...providerConfiguration,
        userId: enrollmentUserId,
        aliasing: enrollmentAliasing ? [...enrollmentAliasing] : enrollmentAliasing,
        appVersion: enrollmentAppVersion,
        deviceId: result.deviceId,
        registrationState: result.registrationState,
        source: usesLegacyEnrollment ? 'legacy' : 'explicit'
      }
    }

    return getRuntimeStateUpdate(result)
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

      const deviceId = enrolledSessionRef.current?.deviceId ?? null

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
