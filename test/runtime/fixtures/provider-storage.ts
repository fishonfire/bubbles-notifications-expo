import type { StoredDeviceState } from '../../../src/storage/device-state'

interface ProviderStorageFixtureState {
  stored: StoredDeviceState;
  prepare: (url: string, appId: string | number, appKey: string) => void;
  mark: (scope: string, deviceId: string | null) => void;
  bind: (scope: string, deviceId: string, previousDeviceId?: string | null) => void;
}

// Keep these mutations synchronous within their async methods: lifecycle tests
// depend on the ordering of storage marks and canonical registration responses.
export function createProviderStorageFixture (native: ProviderStorageFixtureState) {
  return {
    getRegistrationScope: (url: string, appId: string | number) => `${url}/${appId}`,
    prepareRegistrationScope: async (url: string, appId: string | number, appKey: string, isCurrent?: () => boolean) => {
      native.prepare(url, appId, appKey)
      if (isCurrent && !isCurrent()) throw new Error('Stale scope')
      native.stored = { ...native.stored, apiBaseUrl: url, appKey, registrationScope: `${url}/${appId}` }

      return { ...native.stored }
    },
    readStoredDeviceStateAsync: async () => ({ ...native.stored }),
    readStoredDeviceIdAsync: async () => native.stored.deviceId,
    patchStoredDeviceStateAsync: async (patch: StoredDeviceState) => (native.stored = { ...native.stored, ...patch }),
    acknowledgeRegistrationScope: async (scope: string, deviceId: string, installationId: string, _subscription: unknown, _appId: unknown, isCurrent?: () => boolean) => {
      if (isCurrent && !isCurrent()) throw new Error('Stale acknowledgement')
      delete native.stored.registrationLogoutTargets?.[scope]
      native.stored = { ...native.stored, deviceId, identityAcknowledged: true, acknowledgedInstallationId: installationId }

      return { ...native.stored }
    },
    markPendingLogout: async (scope: string, deviceId: string | null) => {
      native.mark(scope, deviceId)
      // Mirror the storage contract at this boundary: pending/receipt/trusted
      // targets take priority over a caller snapshot. Actual persistence is
      // tested separately; this suite verifies provider lifecycle orchestration.
      const scopedTarget = native.stored.registrationLogoutTargets?.[scope] ?? (native.stored.registrationScope === scope ? native.stored.deviceId : native.stored.legacyLogoutTargets?.[scope] ?? null)

      native.stored.pendingLogouts = { ...native.stored.pendingLogouts, [scope]: native.stored.pendingLogouts?.[scope] ?? scopedTarget ?? deviceId }
    },
    clearPendingLogout: async (scope: string) => { delete native.stored.pendingLogouts?.[scope] },
    bindPendingLogoutTarget: async (scope: string, deviceId: string, previousDeviceId?: string | null) => {
      native.bind(scope, deviceId, previousDeviceId)
      native.stored.registrationLogoutTargets = { ...native.stored.registrationLogoutTargets, [scope]: deviceId }
      if (!native.stored.pendingLogouts || !Object.prototype.hasOwnProperty.call(native.stored.pendingLogouts, scope)) return false
      if (native.stored.pendingLogouts[scope] === null || native.stored.pendingLogouts[scope] === native.stored.legacyLogoutTargets?.[scope] || (previousDeviceId != null && native.stored.pendingLogouts[scope] === previousDeviceId)) native.stored.pendingLogouts[scope] = deviceId

      return true
    }
  }
}
