import { getOrCreateInstallationId } from '../storage/installation-id'
import { captureScopedSubscription, prepareRegistrationScope, type StoredDeviceState } from '../storage/device-state'

export interface OneSignalMigrationBridge {
  getSubscriptionId(): Promise<string | null>;
  subscribe(listener: (id: string | null) => void): () => void;
}

export type OneSignalMigration =
  | { policy: 'disabled' }
  | { policy: 'required'; oneSignalAppId: string; bridge: OneSignalMigrationBridge; readinessTimeoutMs?: number }

export class BubblesMigrationPendingError extends Error {
  constructor () {
    super('OneSignal subscription identity is not ready. Registration remains pending; retry when the subscription is available.')
    this.name = 'BubblesMigrationPendingError'
  }
}

export function normalizeSubscriptionId (id: string | null): string | null {
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

async function readBridge (bridge: OneSignalMigrationBridge, timeoutMs: number): Promise<string | null> {
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await new Promise<string | null>((resolve, reject) => {
      // Observe before reading so an ID becoming ready cannot fall between the two.
      unsubscribe = bridge.subscribe((id) => {
        const normalized = normalizeSubscriptionId(id)

        if (normalized) resolve(normalized)
      })
      timer = setTimeout(() => resolve(null), timeoutMs)
      Promise.resolve().then(() => bridge.getSubscriptionId()).then((id) => {
        const normalized = normalizeSubscriptionId(id)

        if (normalized) resolve(normalized)
      }, reject)
    })
  } finally {
    if (timer) clearTimeout(timer)
    unsubscribe?.()
  }
}

async function resolveMigrationSubscription (
  state: StoredDeviceState,
  registrationScope: string,
  migration: OneSignalMigration | undefined,
  acknowledged: boolean,
  isCurrent?: () => boolean
): Promise<string | null> {
  const oneSignalSubscriptionId = state.oneSignalSubscriptionId ?? null

  if (migration?.policy !== 'required') return oneSignalSubscriptionId
  if (!migration.oneSignalAppId.trim()) throw new Error('OneSignal migration requires the original OneSignal app ID.')
  if (state.oneSignalAppId && state.oneSignalAppId !== migration.oneSignalAppId.trim()) {
    throw new Error('OneSignal application changed; device identity requires reconciliation.')
  }
  if (oneSignalSubscriptionId || acknowledged) return oneSignalSubscriptionId
  const timeout = migration.readinessTimeoutMs ?? 3000

  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 30000) throw new Error('OneSignal readiness timeout must be between 0 and 30000 milliseconds.')
  const subscriptionId = await readBridge(migration.bridge, timeout)

  if (!subscriptionId) throw new BubblesMigrationPendingError()
  await captureScopedSubscription(registrationScope, subscriptionId, migration.oneSignalAppId.trim(), isCurrent)

  return subscriptionId
}

export async function resolveRegistrationIdentity (options: {
  apiBaseUrl: string; appId: string | number; appKey: string; isCurrent?: () => boolean; oneSignalMigration?: OneSignalMigration;
}) {
  if (options.isCurrent && !options.isCurrent()) throw new Error('Registration configuration changed.')
  const installationId = await getOrCreateInstallationId()

  if (options.isCurrent && !options.isCurrent()) throw new Error('Registration configuration changed.')
  const state = await prepareRegistrationScope(options.apiBaseUrl, options.appId, options.appKey, options.isCurrent)
  const registrationScope = state.registrationScope

  if (!registrationScope) throw new Error('Registration scope is missing after preparation.')
  const migration = options.oneSignalMigration
  const acknowledged = state.identityAcknowledged === true && state.acknowledgedInstallationId === installationId &&
    (migration?.policy !== 'required' || !!state.oneSignalSubscriptionId)
  const oneSignalSubscriptionId = await resolveMigrationSubscription(state, registrationScope, migration, acknowledged, options.isCurrent)

  return { installationId, oneSignalSubscriptionId, registrationScope,
    deviceId: acknowledged ? state.deviceId : null,
    oneSignalAppId: state.oneSignalAppId ?? (migration?.policy === 'required' ? migration.oneSignalAppId.trim() : undefined) }
}
