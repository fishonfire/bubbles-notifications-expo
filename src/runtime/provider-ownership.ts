import type { OneSignalMigration } from './migration'

export interface BubblesProviderConfiguration {
  appId: string | number;
  appKey: string;
  apiBaseUrl: string;
  oneSignalMigration?: OneSignalMigration;
}

interface ProviderLease {
  owner: object;
  configuration: BubblesProviderConfiguration;
  revoke: () => void;
}

let currentLease: ProviderLease | null = null
const retiredOwners = new WeakSet<object>()

function areMigrationsCompatible (left?: OneSignalMigration, right?: OneSignalMigration): boolean {
  if ((left?.policy ?? 'disabled') !== (right?.policy ?? 'disabled')) return false
  if (left?.policy !== 'required' || right?.policy !== 'required') return true

  return left.oneSignalAppId === right.oneSignalAppId &&
    left.bridge === right.bridge &&
    (left.readinessTimeoutMs ?? 3000) === (right.readinessTimeoutMs ?? 3000)
}

export function areBubblesProviderConfigurationsCompatible (
  left: BubblesProviderConfiguration,
  right: BubblesProviderConfiguration
): boolean {
  return left.appId === right.appId && left.appKey === right.appKey &&
    left.apiBaseUrl === right.apiBaseUrl &&
    areMigrationsCompatible(left.oneSignalMigration, right.oneSignalMigration)
}

export function isCurrentBubblesProvider (owner: object): boolean {
  return currentLease?.owner === owner
}

export function isRetiredBubblesProvider (owner: object): boolean {
  return retiredOwners.has(owner)
}

/**
 * The latest compatible committed provider owns the runtime. A superseded
 * provider is retired permanently, even if it never runs React cleanup.
 */
export function acquireBubblesProviderOwnership (
  owner: object,
  configuration: BubblesProviderConfiguration,
  revoke: () => void
): () => void {
  if (retiredOwners.has(owner)) return () => undefined
  const previousLease = currentLease

  if (previousLease && previousLease.owner !== owner &&
      !areBubblesProviderConfigurationsCompatible(previousLease.configuration, configuration)) {
    throw new Error(
      '[@fishonfire/bubbles-expo] Overlapping BubblesNotificationsProviders require matching app credentials, backend, and migration configuration.'
    )
  }

  const lease: ProviderLease = { owner, configuration: { ...configuration }, revoke }

  // Invalidate old work before disposing its listeners. Its eventual cleanup
  // must never clear the replacement lease or restore an older provider.
  currentLease = lease
  if (previousLease && previousLease.owner !== owner) retiredOwners.add(previousLease.owner)
  previousLease?.revoke()

  return () => {
    if (currentLease !== lease) return
    currentLease = null
    lease.revoke()
  }
}
