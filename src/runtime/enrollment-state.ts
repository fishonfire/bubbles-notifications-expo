import type { BubblesNotificationsProviderProps, RegisterDeviceOptions } from './context'
import type { EnrolledSession } from './provider-state'

export type EnrollmentRequest =
  | { kind: 'legacy' }
  | { kind: 'explicit'; options: RegisterDeviceOptions }

type SessionState =
  | { status: 'idle'; session: null }
  | { status: 'active'; session: EnrolledSession }
  | { status: 'suspended'; session: EnrolledSession | null }

type LegacyEnrollmentInputs = Pick<BubblesNotificationsProviderProps, 'ready' | 'userId' | 'aliasing' | 'appVersion'>

// This state belongs to one provider, including across same-owner Suspense
// reveals. It changes synchronously; React state remains the public snapshot.
export function createEnrollmentState () {
  let sessionState: SessionState = { status: 'suspended', session: null }
  let pending: EnrollmentRequest | { kind: 'none' } = { kind: 'none' }
  let legacyInputs: LegacyEnrollmentInputs = {}
  const operations = new Set<object>()

  return {
    getSession () { return sessionState.session },
    isSuspended () { return sessionState.status === 'suspended' },
    getLegacyInputs () { return legacyInputs },
    getRetryRequest () {
      return operations.size === 0 && pending.kind !== 'none' ? pending : null
    },
    commitLegacyInputs (inputs: LegacyEnrollmentInputs) {
      legacyInputs = inputs
    },
    suspend () {
      sessionState = { status: 'suspended', session: sessionState.session }
    },
    resume () {
      if (sessionState.session) sessionState = { status: 'active', session: sessionState.session }
    },
    setSession (session: EnrolledSession) {
      sessionState = { status: sessionState.status === 'suspended' ? 'suspended' : 'active', session }
    },
    clearSession () {
      sessionState = sessionState.status === 'suspended'
        ? { status: 'suspended', session: null }
        : { status: 'idle', session: null }
    },
    setPending (request: EnrollmentRequest) {
      pending = request
    },
    clearPending () {
      pending = { kind: 'none' }
    },
    begin (request: EnrollmentRequest) {
      const operation = {}

      sessionState = { status: 'suspended', session: sessionState.session }
      pending = request
      operations.add(operation)

      return () => { operations.delete(operation) }
    },
    reset () {
      sessionState = { status: 'suspended', session: null }
      pending = { kind: 'none' }
      // Accepted operations still drain and release their own records.
    }
  }
}
