import { failWithBubblesError } from '../internal/errors'

/** Gates logout persistence on ownership without delaying accepted storage marks. */
export function createLogoutOwnershipGate () {
  let accepted = false
  const pendingMarks = new Set<() => void>()

  function flushPending () {
    for (const mark of [...pendingMarks]) mark()
  }

  function acceptOwnership () {
    accepted = true
    // Start storage mutations before stale enrollment continuations can bind
    // their canonical ID. Acceptance remains valid after provider retirement.
    flushPending()
  }

  function markLogout (persist: () => Promise<void>): Promise<void> {
    const markAcceptedLogout = () => {
      if (!accepted) {
        failWithBubblesError('Logout requires successful BubblesNotificationsProvider ownership acquisition.')
      }

      return persist()
    }

    if (accepted) return markAcceptedLogout()

    return new Promise<void>((resolve, reject) => {
      const mark = () => {
        if (!pendingMarks.delete(mark)) return
        try {
          resolve(markAcceptedLogout())
        } catch (error) {
          reject(error)
        }
      }

      pendingMarks.add(mark)
      // Settle requests even if a descendant throws before acquisition runs.
      // After an acquisition flush, deleting the callback makes this a no-op.
      void Promise.resolve().then(mark)
    })
  }

  return { acceptOwnership, flushPending, markLogout }
}
