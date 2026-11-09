import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { failWithBubblesError } from '../internal/errors'
import type { RegisterDeviceOptions } from './context'
import { createLogoutOwnershipGate } from './logout-ownership'
import {
  acquireBubblesProviderOwnership,
  isCurrentBubblesProvider,
  isRetiredBubblesProvider,
  type BubblesProviderConfiguration
} from './provider-ownership'
import type { EnrolledSession } from './provider-state'

interface ProviderLifecycleOptions extends BubblesProviderConfiguration {
  isMountedRef: RefObject<boolean>;
  lifecycleVersionRef: RefObject<number>;
  enrollmentRequestVersionRef: RefObject<number>;
  desiredOperationRef: RefObject<number>;
  enrolledSessionRef: RefObject<EnrolledSession | null>;
  sessionSuspendedRef: RefObject<boolean>;
  pendingEnrollmentRef: RefObject<RegisterDeviceOptions | undefined | null>;
  invalidateRegistrations: () => void;
  resetPendingMaintenance: () => void;
  clearRequestedMaintenance: () => void;
  clearLogoutRetry: () => void;
  onOwnershipAcquired: () => void;
}

// Call after configuration invalidation and before the provider's passive
// subscriptions so acquisition, revocation, and Suspense reconnection keep
// their layout-effect ordering.
export function useBubblesProviderLifecycle ({
  appId,
  appKey,
  apiBaseUrl,
  oneSignalMigration: stableMigration,
  isMountedRef,
  lifecycleVersionRef,
  enrollmentRequestVersionRef,
  desiredOperationRef,
  enrolledSessionRef,
  sessionSuspendedRef,
  pendingEnrollmentRef,
  invalidateRegistrations,
  resetPendingMaintenance,
  clearRequestedMaintenance,
  clearLogoutRetry,
  onOwnershipAcquired
}: ProviderLifecycleOptions) {
  const [ownershipEpoch, setOwnershipEpoch] = useState(0)
  const hasAcquiredOwnershipRef = useRef(false)
  const providerOwnerRef = useRef({})
  const logoutOwnershipRef = useRef(createLogoutOwnershipGate())
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

  useLayoutEffect(() => {
    const owner = providerOwnerRef.current
    const configuration = { appId, appKey, apiBaseUrl, oneSignalMigration: stableMigration }

    if (isRetiredBubblesProvider(owner)) return
    const revoke = () => {
      logoutOwnershipRef.current.suspendOwnership()
      isMountedRef.current = false
      lifecycleVersionRef.current += 1
      resetPendingMaintenance()
      invalidateRegistrations()
      enrollmentRequestVersionRef.current += 1
      desiredOperationRef.current += 1
      // Suspense disconnects layout effects without unmounting passive consumers.
      // Keep their session/intent for the same owner, but never for a successor.
      if (isRetiredBubblesProvider(owner)) {
        enrolledSessionRef.current = null
        sessionSuspendedRef.current = true
        pendingEnrollmentRef.current = null
      }
      clearRequestedMaintenance()
      clearLogoutRetry()
      for (const cleanup of [...listenerCleanupsRef.current]) cleanup()
    }
    let release: () => void

    try {
      release = acquireBubblesProviderOwnership(owner, configuration, revoke)
    } catch (error) {
      // Child layout effects run first and may already have queued enrollment.
      // A failed acquisition has no React cleanup, so retire that work now.
      revoke()
      logoutOwnershipRef.current.flushPending()
      throw error
    }

    isMountedRef.current = true
    logoutOwnershipRef.current.acceptOwnership()
    onOwnershipAcquired()
    // Reveal reconnects layout effects, but may leave passive effects mounted.
    // Re-run owned resources in their original passive phase after reacquisition.
    if (hasAcquiredOwnershipRef.current) setOwnershipEpoch((current) => current + 1)
    hasAcquiredOwnershipRef.current = true

    return release
  }, [appId, appKey, apiBaseUrl, stableMigration, isMountedRef, invalidateRegistrations, clearLogoutRetry, resetPendingMaintenance, clearRequestedMaintenance, lifecycleVersionRef, enrollmentRequestVersionRef, desiredOperationRef, enrolledSessionRef, sessionSuspendedRef, pendingEnrollmentRef, onOwnershipAcquired])

  function assertCurrentProvider () {
    if (!isMountedRef.current) failWithBubblesError('This BubblesNotificationsProvider has been replaced or unmounted.')
  }

  function assertProviderOwnership (operation: 'Registration' | 'Logout') {
    assertCurrentProvider()
    if (!isCurrentBubblesProvider(providerOwnerRef.current)) {
      failWithBubblesError(`${operation} requires successful BubblesNotificationsProvider ownership acquisition.`)
    }
  }

  function isCurrentProvider () {
    return isCurrentBubblesProvider(providerOwnerRef.current)
  }

  function runOwnedLogout (operation: () => Promise<void>): Promise<void> {
    return logoutOwnershipRef.current.runLogout(operation)
  }

  return {
    providerOwnerRef,
    ownershipEpoch,
    observeCurrentProvider,
    isCurrentProvider,
    assertCurrentProvider,
    assertProviderOwnership,
    runOwnedLogout
  }
}
