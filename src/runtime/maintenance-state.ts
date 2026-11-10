// Coalesce events without losing a request that arrives during an async pass.
export function createMaintenanceState () {
  let phase: 'idle' | 'running' | 'rerun' = 'idle'

  return {
    start () {
      if (phase !== 'idle') return false
      phase = 'running'

      return true
    },
    request () {
      if (phase !== 'idle') {
        phase = 'rerun'

        return false
      }
      phase = 'running'

      return true
    },
    beginPass () {
      phase = 'running'
    },
    get needsRerun () { return phase === 'rerun' },
    clearRerun () {
      if (phase === 'rerun') phase = 'running'
    },
    finish () {
      const rerun = phase === 'rerun'

      phase = 'idle'

      return rerun
    },
    reset () {
      phase = 'idle'
    }
  }
}
