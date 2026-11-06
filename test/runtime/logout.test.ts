import assert from 'node:assert/strict'
import { beforeEach, afterEach, test, vi } from 'vitest'

const fileContents = new Map<string, string>()
const documentDirectory = '/mock/document'
const storedStateUri = `${documentDirectory}/bubbles-notifications/bubbles-notifications-expo-state.json`
const recoveryInstallationId = '4885590c-7ce2-444a-8bfb-5c2adba24296'
const outgoingUser = 'outgoing-user'
let afterFileMove: (() => Promise<void>) | null = null

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
    if (afterFileMove) await afterFileMove()
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
vi.doMock('expo-crypto', () => ({ randomUUID: () => recoveryInstallationId }))
vi.doMock('../../src/runtime/device-attributes.ts', () => ({ collectBubblesDeviceAttributes: async () => ({}) }))
vi.doMock('../../src/notifications/delivery-status.ts', () => ({ flushStoredBubblesDeliveryStatuses: async () => undefined }))

const { markBubblesLogout, retryBubblesLogout } = await import('../../src/runtime/logout.ts')
const { syncDeviceRegistrationState } = await import('../../src/runtime/sync-device.ts')
const { resolveRegistrationIdentity } = await import('../../src/runtime/migration.ts')
const { getRegistrationScope, readStoredDeviceStateAsync, prepareRegistrationScope, acknowledgeRegistrationScope, markPendingLogout, clearPendingLogout, bindPendingLogoutTarget } = await import('../../src/storage/device-state.ts')
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
  afterFileMove = null
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

test('a stale first enrollment binds only its pending logout and disables before clearing intent', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await markBubblesLogout(configuration, null)
  const replacementConfiguration = { ...configuration, apiBaseUrl: wrongBackend }

  await prepareRegistrationScope(replacementConfiguration.apiBaseUrl, replacementConfiguration.appId, replacementConfiguration.appKey)
  assert.equal(await bindPendingLogoutTarget(scope, canonicalDevice), true)
  let state = await readStoredDeviceStateAsync()

  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
  assert.equal(state.deviceId, null)
  assert.equal(state.identityAcknowledged, false)
  assert.equal(state.pendingLogouts?.[scope], canonicalDevice)
  fetchMock.mockImplementationOnce(async () => {
    assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], canonicalDevice)

    throw new Error('disable failed')
  })
  await assert.rejects(retryBubblesLogout(configuration), /disable failed/)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], canonicalDevice)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[1][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)), { notifications_enabled: false })
  state = await readStoredDeviceStateAsync()
  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.deviceId, null)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
})

test('stale enrollment cannot create logout intent or replace another known logout target', async () => {
  assert.equal(await bindPendingLogoutTarget(scope, canonicalDevice), false)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts, undefined)
  // An unrelated pending intent is independent of the preceding response receipt.
  fileContents.clear()
  await markPendingLogout(scope, knownDevice)
  assert.equal(await bindPendingLogoutTarget(scope, canonicalDevice), true)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
  const otherScope = getRegistrationScope(wrongBackend, configuration.appId)

  await markPendingLogout(otherScope, null)
  await bindPendingLogoutTarget(scope, canonicalDevice)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[otherScope], null)
  await bindPendingLogoutTarget(scope, canonicalDevice, 'unrelated-device')
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
})

test.each([null, knownDevice])('synchronous accepted logout marking precedes an already-ready stale response in serialized storage (%s)', async (previousDeviceId) => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  // A resolved outgoing response has already scheduled its stale continuation.
  const drainedResponse = Promise.resolve().then(() => bindPendingLogoutTarget(scope, canonicalDevice, previousDeviceId))
  // Ownership acceptance invokes this synchronously before yielding the commit.
  const marked = markBubblesLogout(configuration, previousDeviceId)

  assert.equal(await drainedResponse, true)
  await marked
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], canonicalDevice)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)), { notifications_enabled: false })
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
  assert.equal((await readStoredDeviceStateAsync()).deviceId, null)
})

test('stale 404 recovery rebinds the old requested logout target to the returned canonical ID', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await acknowledgeRegistrationScope(scope, knownDevice, installationId)
  await markBubblesLogout(configuration, knownDevice)
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  assert.equal(await bindPendingLogoutTarget(scope, canonicalDevice, knownDevice), true)
  let state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], canonicalDevice)
  assert.equal(state.deviceId, null)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
  fetchMock.mockRejectedValueOnce(new Error('disable failed'))
  await assert.rejects(retryBubblesLogout(configuration), /disable failed/)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], canonicalDevice)
  await retryBubblesLogout(configuration)
  assert.deepEqual(fetchMock.mock.calls.map(([url]) => url), [
    `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`,
    `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`
  ])
  state = await readStoredDeviceStateAsync()
  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.deviceId, null)
})

test('real 404 recovery POST followed by handover disables the new canonical ID instead of the missing old device', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await acknowledgeRegistrationScope(scope, knownDevice, recoveryInstallationId)
  let finishRecovery!: (response: Response) => void
  let markRecoveryStarted!: () => void
  const recoveryStarted = new Promise<void>(resolve => { markRecoveryStarted = resolve })
  const recoveryResponse = new Promise<Response>(resolve => { finishRecovery = resolve })
  let current = true

  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
  fetchMock.mockImplementationOnce(async () => {
    markRecoveryStarted()

    return recoveryResponse
  })
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: knownDevice,
    registrationIdentity: { deviceId: knownDevice, registrationScope: scope, installationId: recoveryInstallationId, oneSignalSubscriptionId: null, oneSignalAppId: undefined },
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })
  const rejectedRegistration = assert.rejects(registration, /Registration configuration changed/)

  await recoveryStarted
  await markBubblesLogout(configuration, knownDevice)
  current = false
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  finishRecovery(new Response(JSON.stringify({ id: canonicalDevice, installation_id: recoveryInstallationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  await rejectedRegistration

  assert.deepEqual(fetchMock.mock.calls.map(([url, options]) => [url, options?.method]), [
    [`${configuration.apiBaseUrl}/api/devices/${knownDevice}`, 'PUT'],
    [`${configuration.apiBaseUrl}/api/devices/create`, 'POST'],
    [`${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`, 'PUT']
  ])
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)), { notifications_enabled: false })
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.deviceId, null)
  assert.equal(state.identityAcknowledged, false)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
})

test('repeated logout after a failed stale recovery disable retains the canonical target instead of a stale snapshot', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await acknowledgeRegistrationScope(scope, knownDevice, recoveryInstallationId)
  let finishRecovery!: (response: Response) => void
  let markRecoveryStarted!: () => void
  const recoveryStarted = new Promise<void>(resolve => { markRecoveryStarted = resolve })
  const recoveryResponse = new Promise<Response>(resolve => { finishRecovery = resolve })
  let current = true
  let canonicalEnabled: boolean

  fetchMock.mockImplementation(async (url) => {
    if (url === `${configuration.apiBaseUrl}/api/devices/${knownDevice}`) return new Response('{}', { status: 404 })
    assert.equal(url, `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
    canonicalEnabled = false

    return new Response('{}', { status: 200 })
  })
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
  fetchMock.mockImplementationOnce(async () => {
    markRecoveryStarted()

    return recoveryResponse
  })
  fetchMock.mockRejectedValueOnce(new Error('canonical disable offline'))
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: knownDevice,
    registrationIdentity: { deviceId: knownDevice, registrationScope: scope, installationId: recoveryInstallationId, oneSignalSubscriptionId: null, oneSignalAppId: undefined },
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })
  const rejectedRegistration = assert.rejects(registration, /canonical disable offline/)

  await recoveryStarted
  await markBubblesLogout(configuration, knownDevice)
  current = false
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  canonicalEnabled = true
  finishRecovery(new Response(JSON.stringify({ id: canonicalDevice, installation_id: recoveryInstallationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  await rejectedRegistration
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], canonicalDevice)
  await markBubblesLogout(configuration, knownDevice)
  await retryBubblesLogout(configuration)
  assert.equal(canonicalEnabled, false)
  assert.equal(fetchMock.mock.calls[3][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[3][1]?.body)), { notifications_enabled: false })
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.deviceId, null)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
})

test('legacy upgrade logout follows a stale first reconciliation to its returned canonical device', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey }))
  const identity = await resolveRegistrationIdentity(configuration)

  assert.equal(identity.deviceId, null)
  assert.equal((await readStoredDeviceStateAsync()).legacyLogoutTargets?.[scope], legacyDevice)
  let finishEnrollment!: (response: Response) => void
  let markEnrollmentStarted!: () => void
  const enrollmentStarted = new Promise<void>(resolve => { markEnrollmentStarted = resolve })
  const enrollmentResponse = new Promise<Response>(resolve => { finishEnrollment = resolve })
  let current = true

  fetchMock.mockImplementationOnce(async () => {
    markEnrollmentStarted()

    return enrollmentResponse
  })
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: null, registrationIdentity: identity,
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })
  const rejectedRegistration = assert.rejects(registration, /Registration configuration changed/)

  await enrollmentStarted
  await markBubblesLogout(configuration, null)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], legacyDevice)
  current = false
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  finishEnrollment(new Response(JSON.stringify({ id: canonicalDevice, installation_id: identity.installationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  await rejectedRegistration
  assert.deepEqual(fetchMock.mock.calls.map(([url, options]) => [url, options?.method]), [
    [`${configuration.apiBaseUrl}/api/devices/create`, 'POST'],
    [`${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`, 'PUT']
  ])
  assert.deepEqual(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)), { notifications_enabled: false })
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
  assert.equal(state.deviceId, null)
  assert.equal(state.identityAcknowledged, false)
})

test('logout during stale installation reconciliation disables the new canonical identity instead of its unacknowledged predecessor', async () => {
  fileContents.set(`${documentDirectory}/bubbles-notifications/bubbles-notifications-installation-id.txt`, recoveryInstallationId)
  fileContents.set(storedStateUri, JSON.stringify({
    version: 2, deviceId: knownDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey,
    registrationScope: scope, identityAcknowledged: true, acknowledgedInstallationId: '00000000-0000-4000-8000-000000000000'
  }))
  const identity = await resolveRegistrationIdentity(configuration)

  assert.equal(identity.deviceId, null)
  assert.equal((await readStoredDeviceStateAsync()).deviceId, knownDevice)
  assert.equal((await readStoredDeviceStateAsync()).legacyLogoutTargets?.[scope], undefined)
  let finishEnrollment!: (response: Response) => void
  let markEnrollmentStarted!: () => void
  const enrollmentStarted = new Promise<void>(resolve => { markEnrollmentStarted = resolve })
  const enrollmentResponse = new Promise<Response>(resolve => { finishEnrollment = resolve })
  let current = true

  fetchMock.mockImplementationOnce(async () => {
    markEnrollmentStarted()

    return enrollmentResponse
  })
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: knownDevice, registrationIdentity: identity,
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })
  const rejectedRegistration = assert.rejects(registration, /Registration configuration changed/)

  await enrollmentStarted
  await markBubblesLogout(configuration, null)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
  current = false
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  finishEnrollment(new Response(JSON.stringify({ id: canonicalDevice, installation_id: identity.installationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  await rejectedRegistration
  assert.deepEqual(fetchMock.mock.calls.map(([url, options]) => [url, options?.method]), [
    [`${configuration.apiBaseUrl}/api/devices/create`, 'POST'],
    [`${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`, 'PUT']
  ])
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.deviceId, null)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
})

test('logout during asynchronous acknowledgement disables the committed canonical ID instead of a stale snapshot', async () => {
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  await acknowledgeRegistrationScope(scope, knownDevice, recoveryInstallationId)
  let releaseAcknowledgement!: () => void
  let markAcknowledgementCommitted!: () => void
  const acknowledgementCommitted = new Promise<void>(resolve => { markAcknowledgementCommitted = resolve })
  const acknowledgementCompletion = new Promise<void>(resolve => { releaseAcknowledgement = resolve })
  let current = true
  let canonicalEnabled = true

  afterFileMove = async () => {
    if (JSON.parse(fileContents.get(storedStateUri) ?? '{}').deviceId !== canonicalDevice) return
    afterFileMove = null
    markAcknowledgementCommitted()
    await acknowledgementCompletion
  }
  fetchMock.mockImplementation(async (url) => {
    if (url === `${configuration.apiBaseUrl}/api/devices/${knownDevice}`) return new Response('{}', { status: 404 })
    assert.equal(url, `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
    canonicalEnabled = false

    return new Response('{}', { status: 200 })
  })
  fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: canonicalDevice, installation_id: recoveryInstallationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: knownDevice,
    registrationIdentity: { deviceId: knownDevice, registrationScope: scope, installationId: recoveryInstallationId, oneSignalSubscriptionId: null, oneSignalAppId: undefined },
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })

  await acknowledgementCommitted
  current = false
  const marked = markBubblesLogout(configuration, knownDevice)

  releaseAcknowledgement()
  await Promise.all([registration, marked])
  await retryBubblesLogout(configuration)
  assert.equal(canonicalEnabled, false)
  assert.equal(fetchMock.mock.calls[2][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
})

test('a stale response without logout intent persists only scoped logout provenance for a later mount', async () => {
  const identity = await resolveRegistrationIdentity(configuration)
  let finishEnrollment!: (response: Response) => void
  let markEnrollmentStarted!: () => void
  const enrollmentStarted = new Promise<void>(resolve => { markEnrollmentStarted = resolve })
  const enrollmentResponse = new Promise<Response>(resolve => { finishEnrollment = resolve })
  let current = true

  fetchMock.mockImplementationOnce(async () => {
    markEnrollmentStarted()

    return enrollmentResponse
  })
  const registration = syncDeviceRegistrationState({
    ...configuration, userId: outgoingUser, deviceId: null, registrationIdentity: identity,
    registrationState: { platform: 'android', tokenType: 'fcm', token: 'token', fid: 'fid', permissionStatus: 'granted', notificationsEnabled: true },
    isCurrent: () => current
  })
  const rejectedRegistration = assert.rejects(registration, /Registration configuration changed/)

  await enrollmentStarted
  current = false
  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  finishEnrollment(new Response(JSON.stringify({ id: canonicalDevice, installation_id: identity.installationId }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }))
  await rejectedRegistration
  assert.equal(fetchMock.mock.calls.length, 1)
  let state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts, undefined)
  assert.equal(state.registrationLogoutTargets?.[scope], canonicalDevice)
  assert.equal(state.deviceId, null)
  assert.equal(state.identityAcknowledged, false)
  assert.equal(state.registrationScope, getRegistrationScope(wrongBackend, configuration.appId))
  const persisted = fileContents.get(storedStateUri) ?? '{}'

  fileContents.clear()
  fileContents.set(storedStateUri, persisted)
  await markBubblesLogout({ ...configuration, apiBaseUrl: wrongBackend }, null)
  await retryBubblesLogout({ ...configuration, apiBaseUrl: wrongBackend })
  assert.equal(fetchMock.mock.calls.length, 1)
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[1][0], `${configuration.apiBaseUrl}/api/devices/${canonicalDevice}`)
  state = await readStoredDeviceStateAsync()
  assert.equal(state.pendingLogouts?.[scope], undefined)
  assert.equal(state.registrationLogoutTargets?.[scope], canonicalDevice)
  assert.equal(state.deviceId, null)
})

test('acknowledgement supersedes only its scope response receipt and enrollment never uses a logout receipt', async () => {
  const identity = await resolveRegistrationIdentity(configuration)
  const otherScope = getRegistrationScope(wrongBackend, configuration.appId)

  await bindPendingLogoutTarget(scope, canonicalDevice, null)
  await bindPendingLogoutTarget(otherScope, legacyDevice, null)
  assert.equal((await resolveRegistrationIdentity(configuration)).deviceId, null)
  await acknowledgeRegistrationScope(scope, knownDevice, identity.installationId)
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.registrationLogoutTargets?.[scope], undefined)
  assert.equal(state.registrationLogoutTargets?.[otherScope], legacyDevice)
  await markBubblesLogout(configuration, null)
  await retryBubblesLogout(configuration)
  assert.equal(fetchMock.mock.calls[0][0], `${configuration.apiBaseUrl}/api/devices/${knownDevice}`)
})

test('legacy target rebinding requires an existing intent matching the same scope archive', async () => {
  fileContents.set(storedStateUri, JSON.stringify({ version: 1, deviceId: legacyDevice, apiBaseUrl: configuration.apiBaseUrl, appKey: configuration.appKey }))
  await prepareRegistrationScope(configuration.apiBaseUrl, configuration.appId, configuration.appKey)
  assert.equal(await bindPendingLogoutTarget(scope, canonicalDevice, null), false)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts, undefined)
  // Seed a distinct pre-existing intent, rather than marking from a stale caller
  // after the response has already established newer canonical provenance.
  const persisted = JSON.parse(fileContents.get(storedStateUri) ?? '{}')

  delete persisted.registrationLogoutTargets
  fileContents.set(storedStateUri, JSON.stringify({ ...persisted, pendingLogouts: { [scope]: knownDevice } }))
  await bindPendingLogoutTarget(scope, canonicalDevice, null)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
  const otherScope = getRegistrationScope(wrongBackend, configuration.appId)

  await prepareRegistrationScope(wrongBackend, configuration.appId, configuration.appKey)
  await markPendingLogout(otherScope, legacyDevice)
  await bindPendingLogoutTarget(otherScope, canonicalDevice, null)
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.legacyLogoutTargets?.[scope], legacyDevice)
  assert.equal(state.legacyLogoutTargets?.[otherScope], undefined)
  assert.equal(state.pendingLogouts?.[scope], knownDevice)
  assert.equal(state.pendingLogouts?.[otherScope], legacyDevice)
})

test('preserves a known target when marked again without an ID and conditionally clears', async () => {
  await markPendingLogout(scope, knownDevice)
  await markPendingLogout(scope, null)
  await markPendingLogout(scope, 'stale-device')
  await clearPendingLogout(scope, 'older-device')
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], knownDevice)
  await clearPendingLogout(scope, knownDevice)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], undefined)
})

test('a repeated logout fills an unknown target without changing another scope intent', async () => {
  const otherScope = getRegistrationScope(wrongBackend, configuration.appId)

  await markPendingLogout(otherScope, canonicalDevice)
  await markPendingLogout(scope, null)
  assert.equal((await readStoredDeviceStateAsync()).pendingLogouts?.[scope], null)
  await markPendingLogout(scope, knownDevice)
  const state = await readStoredDeviceStateAsync()

  assert.equal(state.pendingLogouts?.[scope], knownDevice)
  assert.equal(state.pendingLogouts?.[otherScope], canonicalDevice)
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
