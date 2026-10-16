import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const ORIGINAL_APP = 'original-app'
const uuid = '4885590c-7ce2-444a-8bfb-5c2adba24296'
const files = new Map<string, string>()
let generations = 0

class MockFile {
  uri: string

  constructor (base: string, name: string) { this.uri = `${base}/${name}` }

  get exists () { return files.has(this.uri) }

  textSync () { const value = files.get(this.uri)

    assert.notEqual(value, undefined)

    return value as string }

  async text () { return this.textSync() }

  write (value: string) { files.set(this.uri, value) }

  delete () { files.delete(this.uri) }

  moveSync (destination: MockFile) {
    files.set(destination.uri, this.textSync()); files.delete(this.uri); this.uri = destination.uri
  }

  async move (destination: MockFile) { this.moveSync(destination) }
}
vi.doMock('expo-file-system', () => ({ File: MockFile, Paths: { document: '/document' } }))
vi.doMock('expo-crypto', () => ({ randomUUID: () => { generations++

  return uuid } }))
const { getOrCreateInstallationId } = await import('../../src/storage/installation-id')
const { prepareRegistrationScope, acknowledgeRegistrationScope, readStoredDeviceStateAsync, captureScopedSubscription } = await import('../../src/storage/device-state')
const { resolveRegistrationIdentity, BubblesMigrationPendingError } = await import('../../src/runtime/migration')
const config = { appId: 42, apiBaseUrl: 'https://api.example.com/api/', appKey: 'key' }

beforeEach(() => { files.clear(); generations = 0 })

function bridge (id: string | null) {
  const listeners = new Set<(id: string | null) => void>()

  return { listeners, getSubscriptionId: async () => id,
    subscribe: (listener: (id: string | null) => void) => { listeners.add(listener)

      return () => { listeners.delete(listener) } } }
}

test('concurrent collection persists one UUID independent of registration metadata', async () => {
  assert.deepEqual(await Promise.all([getOrCreateInstallationId(), getOrCreateInstallationId()]), [uuid, uuid])
  assert.equal(generations, 1)
  files.set('/document/bubbles-notifications-expo-state.json', '{corrupt')
  await readStoredDeviceStateAsync()
  assert.equal(await getOrCreateInstallationId(), uuid)
})

test('v1 state remains readable; first handshake reconciles cached ID and uses scoped canonical binding', async () => {
  files.set('/document/bubbles-notifications-expo-state.json', JSON.stringify({ version: 1, deviceId: 'cached-duplicate', apiBaseUrl: config.apiBaseUrl, appKey: 'old' }))
  assert.equal((await readStoredDeviceStateAsync()).deviceId, 'cached-duplicate')
  const identity = await resolveRegistrationIdentity(config)

  assert.equal(identity.deviceId, null)
  await acknowledgeRegistrationScope(identity.registrationScope, 'canonical', uuid)
  assert.equal((await resolveRegistrationIdentity({ ...config, appKey: 'rotated' })).deviceId, 'canonical')
  const other = await resolveRegistrationIdentity({ ...config, appId: 43 })

  assert.equal(other.deviceId, null)
  assert.equal(other.installationId, uuid)
})

test('required migration defers a missing bridge ID and cleans up bounded readiness observer', async () => {
  const adapter = bridge(null)

  await assert.rejects(resolveRegistrationIdentity({ ...config, oneSignalMigration: {
    policy: 'required', oneSignalAppId: ORIGINAL_APP, bridge: adapter, readinessTimeoutMs: 0
  } }), BubblesMigrationPendingError)
  assert.equal(adapter.listeners.size, 0)
  assert.equal((await readStoredDeviceStateAsync()).identityAcknowledged, false)
})

test('bridge observer installed before read captures readiness and canonical acknowledgement survives bridge removal', async () => {
  const adapter = bridge(null)

  adapter.getSubscriptionId = async () => { for (const listener of adapter.listeners) listener(' legacy-player ')

    return null }
  const identity = await resolveRegistrationIdentity({ ...config, oneSignalMigration: { policy: 'required', oneSignalAppId: ORIGINAL_APP, bridge: adapter } })

  assert.equal(identity.oneSignalSubscriptionId, 'legacy-player')
  assert.equal(adapter.listeners.size, 0)
  await acknowledgeRegistrationScope(identity.registrationScope, 'imported-device', uuid, identity.oneSignalSubscriptionId, identity.oneSignalAppId)
  assert.equal((await resolveRegistrationIdentity(config)).deviceId, 'imported-device')
})

test('capturing bridge on UUID-only binding requires POST again after a failed handshake', async () => {
  const identity = await resolveRegistrationIdentity(config)

  await acknowledgeRegistrationScope(identity.registrationScope, 'previous-duplicate', uuid)
  const required = { ...config, oneSignalMigration: { policy: 'required' as const, oneSignalAppId: ORIGINAL_APP, bridge: bridge('imported-player') } }

  assert.equal((await resolveRegistrationIdentity(required)).deviceId, null)
  assert.equal((await resolveRegistrationIdentity(required)).deviceId, null)
  assert.equal((await readStoredDeviceStateAsync()).identityAcknowledged, false)
})

test('stale configuration cannot overwrite scope or save a delayed bridge identity', async () => {
  const adapter = bridge(null)
  const pending = resolveRegistrationIdentity({ ...config, oneSignalMigration: { policy: 'required', oneSignalAppId: ORIGINAL_APP, bridge: adapter } })

  while (adapter.listeners.size === 0) await Promise.resolve()
  const current = await prepareRegistrationScope(config.apiBaseUrl, 99, 'new')

  for (const listener of adapter.listeners) listener('old-player')
  await assert.rejects(pending, /configuration changed/)
  assert.equal((await readStoredDeviceStateAsync()).registrationScope, current.registrationScope)
  await assert.rejects(resolveRegistrationIdentity({ ...config, isCurrent: () => false }), /configuration changed/)
  assert.equal((await readStoredDeviceStateAsync()).registrationScope, current.registrationScope)
})

test('corrupt or lost UUID fails closed rather than claiming a new installation', async () => {
  files.set('/document/bubbles-notifications-installation-id.txt', 'broken')
  await assert.rejects(getOrCreateInstallationId(), /corrupt/)
  files.delete('/document/bubbles-notifications-installation-id.txt')
  const state = await prepareRegistrationScope(config.apiBaseUrl, config.appId, config.appKey)

  assert.ok(state.registrationScope)
  await acknowledgeRegistrationScope(state.registrationScope, 'device', uuid)
  await assert.rejects(getOrCreateInstallationId(), /missing/)
  assert.equal(generations, 0)
})

test('scoped bridge capture rejects replacement of the original imported identity', async () => {
  const state = await prepareRegistrationScope(config.apiBaseUrl, config.appId, config.appKey)

  assert.ok(state.registrationScope)
  await captureScopedSubscription(state.registrationScope, 'original', 'app')
  await assert.rejects(captureScopedSubscription(state.registrationScope, 'replacement', 'app'), /requires reconciliation/)
})
