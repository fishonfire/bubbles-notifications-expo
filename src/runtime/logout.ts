import { resolveStoredLogoutTarget } from '../storage/logout-target'
import { createBubblesDeviceClient } from '../api/device-client'
import { clearPendingLogout, getRegistrationScope, markPendingLogout, readStoredDeviceStateAsync } from '../storage/device-state'

export interface BubblesLogoutConfiguration {
  apiBaseUrl: string;
  appId: string | number;
  appKey: string;
}

export async function markBubblesLogout (configuration: BubblesLogoutConfiguration, deviceId: string | null): Promise<void> {
  await markPendingLogout(getRegistrationScope(configuration.apiBaseUrl, configuration.appId), deviceId, configuration.appKey)
}

/** Call after registration drains, or on startup before enrolling a new session. */
export async function retryBubblesLogout (configuration: BubblesLogoutConfiguration): Promise<void> {
  const scope = getRegistrationScope(configuration.apiBaseUrl, configuration.appId)
  const state = await readStoredDeviceStateAsync()

  if (!state.pendingLogouts || !Object.prototype.hasOwnProperty.call(state.pendingLogouts, scope)) return

  const pendingTarget = state.pendingLogouts[scope]
  // Retry can still use an archive when matching legacy metadata has no ID.
  // Marking deliberately leaves that case available to the caller's snapshot.
  const deviceId = pendingTarget ?? resolveStoredLogoutTarget(state, scope, configuration.appKey) ?? state.legacyLogoutTargets?.[scope]

  if (!deviceId) {
    await clearPendingLogout(scope, pendingTarget)

    return
  }

  // Bind a pending initial enrollment's result before sending, so a failed request
  // retains its original target even when a later provider uses another scope.
  await markPendingLogout(scope, deviceId)
  const client = createBubblesDeviceClient({ baseUrl: configuration.apiBaseUrl, appKey: configuration.appKey })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    try {
      await client.updateDevice(deviceId, { notifications_enabled: false }, { signal: controller.signal })
    } catch (error) {
      if (!error || typeof error !== 'object' || Reflect.get(error, 'status') !== 404) throw error
    }
    await clearPendingLogout(scope, deviceId)
  } finally {
    clearTimeout(timeout)
  }
}
