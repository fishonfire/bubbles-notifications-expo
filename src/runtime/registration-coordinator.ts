import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction
} from 'react'

import { BubblesNotificationsSyncError } from './sync-device'
import {
  getRuntimeStateUpdate,
  normalizeProviderError,
  type BubblesNotificationsRuntimeState,
  type RuntimeStateUpdate
} from './provider-state'

type RegistrationOperation = () => Promise<Partial<RuntimeStateUpdate> | void>

// A native React root can be replaced before its effects clean up. Keep I/O
// serialized for the JS runtime, rather than for an individual React provider.
let registrationTail: Promise<void> = Promise.resolve()

export function enqueueBubblesRegistration<T> (operation: () => Promise<T>): Promise<T> {
  const registration = registrationTail.then(operation)

  registrationTail = registration.then(() => undefined, () => undefined)

  return registration
}

function getFailedRuntimeState (error: unknown): Partial<RuntimeStateUpdate> {
  return error instanceof BubblesNotificationsSyncError
    ? getRuntimeStateUpdate(error.snapshot)
    : {}
}

export function useBubblesRegistrationCoordinator (
  setState: Dispatch<
    SetStateAction<BubblesNotificationsRuntimeState>
  >
) {
  const isMountedRef = useRef(true)
  const generationRef = useRef(0)
  const invalidateRegistrations = useCallback(() => { generationRef.current += 1 }, [])
  const pendingRegistrationsRef = useRef(0)
  const currentRegistrationRef = useRef<Promise<void> | null>(null)

  const runRegistration = useCallback((
    operation: RegistrationOperation,
    options?: { durable?: boolean }
  ): Promise<void> => {
    const generation = generationRef.current
    const isCurrent = () => isMountedRef.current && generationRef.current === generation

    pendingRegistrationsRef.current += 1

    setState((currentState) => ({
      ...currentState,
      isSyncing: true,
      error: null
    }))

    const registration = enqueueBubblesRegistration(async () => {
      // Logout intent must drain even when its originating React root retires.
      // Its result/error updates still obey the generation checks below.
      if (!options?.durable && !isCurrent()) return

      return operation()
    })
      .then(
        (result) => {
          if (!isCurrent()) {
            return
          }

          setState((currentState) => ({
            ...currentState,
            ...(result ?? {}),
            error: null
          }))
        },
        (error) => {
          const normalizedError = normalizeProviderError(error)
          const failedRuntimeState = getFailedRuntimeState(error)

          if (isCurrent()) {
            setState((currentState) => ({
              ...currentState,
              ...failedRuntimeState,
              error: normalizedError
            }))
          }

          throw normalizedError
        }
      )
      .finally(() => {
        pendingRegistrationsRef.current -= 1

        // Pending work belongs to this hook instance even when its results
        // belong to an invalidated generation (for example a config change).
        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            isSyncing: pendingRegistrationsRef.current > 0
          }))
        }
      })
    const registrationCompletion = registration.then(
      () => undefined,
      () => undefined
    )

    currentRegistrationRef.current = registrationCompletion
    void registrationCompletion.then(() => {
      if (currentRegistrationRef.current === registrationCompletion) {
        currentRegistrationRef.current = null
      }
    })

    return registration
  }, [setState])

  const waitForCurrentRegistration = useCallback(async (): Promise<void> => {
    await currentRegistrationRef.current
  }, [])

  return {
    isMountedRef,
    invalidateRegistrations,
    runRegistration,
    waitForCurrentRegistration
  }
}
