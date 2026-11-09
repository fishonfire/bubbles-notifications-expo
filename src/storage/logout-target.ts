import type { StoredDeviceState } from './device-state'
import { getRegistrationScope } from './registration-scope'

// Resolve stored provenance only; callers retain control of pending targets and
// snapshot fallbacks. Matching legacy metadata is authoritative even without an ID.
export function resolveStoredLogoutTarget (state: StoredDeviceState, scope: string, appKey?: string): string | null {
  if (state.registrationLogoutTargets?.[scope]) return state.registrationLogoutTargets[scope]
  if (state.registrationScope === scope && state.deviceId) return state.deviceId
  if (!state.registrationScope && state.apiBaseUrl && state.appKey === appKey) {
    const [, appId] = JSON.parse(scope) as [string, string]

    if (getRegistrationScope(state.apiBaseUrl, appId) === scope) return state.deviceId
  }

  return state.legacyLogoutTargets?.[scope] ?? null
}
