import assert from 'node:assert/strict'
import { beforeEach, afterEach, test, vi } from 'vitest'

const fileContents = new Map<string, string>()
const documentDirectory = '/mock/document'
const storedStateUri = `${documentDirectory}/bubbles-notifications/bubbles-notifications-expo-state.json`

class MockFile {
  uri: string

  constructor (basePath: string, fileName: string) {
    this.uri = `${basePath}/${fileName}`
  }

  get exists () {
    return fileContents.has(this.uri)
  }

  create () {
    if (!fileContents.has(this.uri)) {
      fileContents.set(this.uri, '')
    }
  }

  textSync () {
    const value = fileContents.get(this.uri)

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`)
    }

    return value
  }

  async text () {
    return this.textSync()
  }

  write (value: string) {
    fileContents.set(this.uri, value)
  }

  delete () {
    if (!fileContents.delete(this.uri)) {
      throw new Error(`Missing file: ${this.uri}`)
    }
  }

  moveSync (destination: MockFile, options?: { overwrite?: boolean }) {
    const value = fileContents.get(this.uri)

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`)
    }

    if (fileContents.has(destination.uri) && !options?.overwrite) {
      throw new Error(`Destination exists: ${destination.uri}`)
    }

    fileContents.set(destination.uri, value)
    fileContents.delete(this.uri)
    this.uri = destination.uri
  }

  async move (destination: MockFile, options?: { overwrite?: boolean }) {
    this.moveSync(destination, options)
  }
}

vi.doMock('expo-file-system', () => ({
  Directory: class {
    uri: string

    constructor (base: string, name: string) { this.uri = `${base}/${name}` }

    create () { /* Directory creation has no effect on the in-memory file map. */ }
  },
  File: MockFile,
  Paths: {
    document: documentDirectory
  }
}))

const { markBubblesLogout, retryBubblesLogout } = await import('../../src/runtime/logout.ts')
const { getRegistrationScope, readStoredDeviceStateAsync, prepareRegistrationScope, acknowledgeRegistrationScope, markPendingLogout, clearPendingLogout } = await import('../../src/storage/device-state.ts')
const configuration = { apiBaseUrl: 'https://push.example.test', appId: 42, appKey: 'test-key' }
const scope = getRegistrationScope(configuration.apiBaseUrl, configuration.appId)
const legacyDevice = 'legacy-device'
const knownDevice = 'known-device'
const canonicalDevice = 'new-canonical'
const wrongBackend = 'https://wrong.example.test'
const legacyDeviceEndpoint = `${configuration.apiBaseUrl}/api/devices/${legacyDevice}`
const installationId = 'installation-id'
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fileContents.clear()
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

test('persists logout intent before sending and retains it after network failure', async () => {
  await markBubblesLogout(configuration, 'canonical/device')
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  await assert.rejects(retryBubblesLogout(configuration), /offline/)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], 'canonical/device')

  await retryBubblesLogout({ ...configuration, appKey: 'rotated-key' })
  const [url, options] = fetchMock.mock.calls[1]

  assert.equal(url, `${configuration.apiBaseUrl}/api/devices/canonical%2Fdevice`)
  assert.deepEqual(JSON.parse(String(options?.body)), { notifications_enabled: false })
  assert.equal((options?.headers as Record<string, string>)['X-App-Key'], 'rotated-key')
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
})

test('preserves pending targets through scope changes and isolates app/backend retries', async () => {
  await markBubblesLogout(configuration, 'old-device')
  await prepareRegistrationScope('https://another.example.test', 42, 'other-key')
  await retryBubblesLogout({ ...configuration, apiBaseUrl: 'https://another.example.test' })
  await retryBubblesLogout({ ...configuration, appId: 43 })
  assert.equal(fetchMock.mock.calls.length, 0)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], 'old-device')

  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls.length, 1)
})

test('resolves a null pending target from the drained canonical registration', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await markBubblesLogout(configuration, null)
  assert.equal(JSON.parse(fileContents.get(storedStateUri) ?? '{}').pendingLogouts[scope], null)
  await acknowledgeRegistrationScope(scope, canonicalDevice, installationId, 'original-subscription', 'original-app')
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  await assert.rejects(retryBubblesLogout(configuration), /offline/)
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], canonicalDevice)
  assert.equal(state.deviceId, canonicalDevice)
  assert.equal(state.acknowledgedInstallationId, installationId)
  assert.equal(state.oneSignalSubscriptionId, 'original-subscription')
})

test('clears a drained null target without sending when no canonical device exists', async () => {
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls.length, 0)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
})

test('preserves a known target when marked again without an ID and conditionally clears', async () => {
  await markPendingLogout(scope, knownDevice)
  await markPendingLogout(scope, null)
  await clearPendingLogout(scope, 'older-device')
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
  await clearPendingLogout(scope, knownDevice)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
})

test('loads older metadata without requiring pending logout state', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: 'legacy-key' }))
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls.length, 0)
  await markBubblesLogout(configuration, legacyDevice)
  assert.equal((await readStoredDeviceStateAsync()).deviceId, legacyDevice)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], legacyDevice)
})

test('resolves legacy canonical logout targets only for the matching backend and key', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: `${configuration.apiBaseUrl}/`, appKey: configuration.appKey }))
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], legacyDeviceEndpoint)
  assert.equal((await readStoredDeviceStateAsync()).deviceId, legacyDevice)

  fetchMock.mockClear()
  await markBubblesLogout({ ...configuration, appKey: 'wrong-key' }, null)
  await retryBubblesLogout({ ...configuration, appKey: 'wrong-key' })
  assert.equal(fetchMock.mock.calls.length, 0)

  await markBubblesLogout({ ...configuration, apiBaseUrl: wrongBackend }, null)
  await retryBubblesLogout({ ...configuration, apiBaseUrl: wrongBackend })
  assert.equal(fetchMock.mock.calls.length, 0)
})

test('atomically captures legacy logout identity before startup resets registration scope', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey }))
  const marked = markBubblesLogout(configuration, null)
  const prepared = prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)

  await Promise.all([marked, prepared])
  assert.equal((await readStoredDeviceStateAsync()).deviceId, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], legacyDeviceEndpoint)
})

test('binds a legacy pending null target before scope preparation discards its metadata', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey, pendingLogouts: { [scope]: null } }))
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], legacyDeviceEndpoint)
})

test('retains verified legacy logout provenance after bootstrap and a persisted reload', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey }))
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  const persisted = fileContents.get(storedStateUri) ?? '{}'

  assert.equal(JSON.parse(persisted).pendingLogouts, undefined)
  assert.equal(JSON.parse(persisted).deviceId, undefined)
  assert.equal(JSON.parse(persisted).legacyLogoutTargets[scope], legacyDevice)
  // Every read reopens persisted metadata; no module-only cache supplies this ID.
  fileContents.clear()
  fileContents.set(storedStateUri, persisted)
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], legacyDeviceEndpoint)
})

test('replaces archived legacy logout provenance with an acknowledged canonical binding', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey }))
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await acknowledgeRegistrationScope(scope, canonicalDevice, installationId)
  assert.equal((await readStoredDeviceStateAsync()).legacyLogoutTargets?.[scope], undefined)
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
})
