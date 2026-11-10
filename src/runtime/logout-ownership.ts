import { failWithBubblesError } from '../internal/errors'

/** Gates logout execution on ownership without delaying accepted storage marks. */
export function createLogoutOwnershipGate () {
  let accepted = false
  const pendingRequests = new Set<() => void>()

  function flushPending () {
    for (const run of [...pendingRequests]) run()
  }

  function acceptOwnership () {
    accepted = true
    // Start storage mutations before stale enrollment continuations can bind
    // their canonical ID.
    flushPending()
  }

  function suspendOwnership () {
    // Gate new requests; accepted operations already have their own promises
    // and continue draining independently of subsequent ownership changes.
    accepted = false
  }

  function runLogout (operation: () => Promise<void>): Promise<void> {
    if (accepted) return operation()

    return new Promise<void>((resolve, reject) => {
      const run = () => {
        if (!pendingRequests.delete(run)) return
        try {
          if (!accepted) {
            failWithBubblesError('Logout requires successful BubblesNotificationsProvider ownership acquisition.')
          }
          resolve(operation())
        } catch (error) {
          reject(error)
        }
      }

      pendingRequests.add(run)
      // Settle requests even if a descendant throws before acquisition runs.
      // After an acquisition flush, deleting the callback makes this a no-op.
      void Promise.resolve().then(run)
    })
  }

  return { acceptOwnership, suspendOwnership, flushPending, runLogout }
}
