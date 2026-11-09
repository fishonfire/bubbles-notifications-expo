import { useCallback, useRef, useState } from 'react'

import { failWithBubblesError } from '../internal/errors'
import { createLogoutOwnershipGate } from './logout-ownership'
import {
  acquireBubblesProviderOwnership,
  isCurrentBubblesProvider,
  isRetiredBubblesProvider,
  type BubblesProviderConfiguration
} from './provider-ownership'

// Own the lease, cancellation generation, and listeners. The provider installs
// acquisition in its layout phase and owns enrollment/maintenance invalidation.
export function useBubblesProviderLifecycle () {
  const isMountedRef = useRef(true)
  const generationRef = useRef(0)
  const [ownershipEpoch, setOwnershipEpoch] = useState(0)
  const hasAcquiredOwnershipRef = useRef(false)
  const providerOwnerRef = useRef({})
  const logoutOwnershipRef = useRef(createLogoutOwnershipGate())
  const listenerCleanupsRef = useRef(new Set<() => void>())
  const captureCurrentLifecycle = useCallback(() => {
    const generation = generationRef.current

    return () => isMountedRef.current && generationRef.current === generation
  }, [])
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

  const acquireOwnership = useCallback((
    configuration: BubblesProviderConfiguration,
    onRevoked: (retired: boolean) => void,
    onAcquired: () => void
  ) => {
    const owner = providerOwnerRef.current

    if (isRetiredBubblesProvider(owner)) return
    const revoke = () => {
      logoutOwnershipRef.current.suspendOwnership()
      isMountedRef.current = false
      generationRef.current += 1
      onRevoked(isRetiredBubblesProvider(owner))
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
    onAcquired()
    // Reveal reconnects layout effects, but may leave passive effects mounted.
    // Re-run owned resources in their original passive phase after reacquisition.
    if (hasAcquiredOwnershipRef.current) setOwnershipEpoch((current) => current + 1)
    hasAcquiredOwnershipRef.current = true

    return release
  }, [])

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
  }
}
