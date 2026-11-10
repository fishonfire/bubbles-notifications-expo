import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { Suspense, StrictMode, useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import type { BubblesNotificationsContextValue, BubblesNotificationsProviderProps } from '../../src/runtime/context'
import type { StoredDeviceState } from '../../src/storage/device-state'
import { createProviderStorageFixture } from './fixtures/provider-storage'

const CURRENT_DEVICE_ID = 'device-current'
const ACKNOWLEDGED_DEVICE_ID = 'acknowledged-device'

type Listener = (value: never) => void
const native = vi.hoisted(() => ({
  currentState: 'active',
  messages: new Set<Listener>(), responses: new Set<Listener>(), tokens: new Set<Listener>(), appStates: new Set<Listener>(),
  flush: vi.fn(async (_state?: StoredDeviceState): Promise<void> => undefined),
  token: vi.fn(async () => 'token-current'),
  prepare: vi.fn(),
  client: vi.fn(),
  mark: vi.fn(),
  bind: vi.fn(),
  lastResponse: null as ReturnType<typeof open> | null,
  schedule: vi.fn(async () => 'local-id'),
  handler: null as null | { handleNotification: () => Promise<Record<string, boolean>> },
  sync: vi.fn(async (_options: Record<string, unknown>) => ({ action: 'created', deviceId: 'initial-device' })),
  update: vi.fn(async (_deviceId: string, _attributes: Record<string, unknown>): Promise<void> => undefined),
  stored: { deviceId: null, apiBaseUrl: null, appKey: null } as StoredDeviceState
}))

function required<Value> (value: Value | null | undefined): Value {
  assert.ok(value)

  return value
}

function subscribe (listeners: Set<Listener>, listener: Listener) {
  listeners.add(listener)

  return () => { listeners.delete(listener) }
}
vi.doMock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { get currentState () { return native.currentState }, addEventListener: (_event: string, listener: Listener) => ({ remove: subscribe(native.appStates, listener) }) }
}))
vi.doMock('expo-constants', () => ({ default: { expoConfig: { extra: { bubblesNotificationsExpo: { defaultChannelId: 'default', defaultChannelName: 'Default', androidChannelImportance: 'default' } } } } }))
vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}), getToken: native.token,
  isDeviceRegisteredForRemoteMessages: () => true, registerDeviceForRemoteMessages: async () => undefined,
  onMessage: (_instance: unknown, listener: Listener) => subscribe(native.messages, listener),
  onTokenRefresh: (_instance: unknown, listener: Listener) => subscribe(native.tokens, listener)
}))
vi.doMock('@react-native-firebase/installations', () => ({ getInstallations: () => ({}), getId: async () => 'firebase-installation' }))
vi.doMock('expo-notifications', () => ({
  IosAuthorizationStatus: { AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  setNotificationHandler: (handler: typeof native.handler) => { native.handler = handler },
  getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  setNotificationChannelAsync: async () => null,
  scheduleNotificationAsync: native.schedule,
  getLastNotificationResponse: () => native.lastResponse,
  clearLastNotificationResponse: () => { native.lastResponse = null },
  addNotificationResponseReceivedListener: (listener: Listener) => ({ remove: subscribe(native.responses, listener) })
}))
vi.doMock('../../src/storage/installation-id', () => ({ getOrCreateInstallationId: async () => 'installation' }))
vi.doMock('../../src/storage/device-state', () => createProviderStorageFixture(native))
vi.doMock('../../src/api/device-client', () => ({
  syncBubblesDevice: native.sync,
  updateBubblesDeviceAttributes: async () => undefined,
  createBubblesDeviceClient: (configuration: Record<string, unknown>) => {
    native.client(configuration)

    return { updateDevice: native.update }
  }
}))
vi.doMock('../../src/runtime/device-attributes', () => ({ collectBubblesDeviceAttributes: async () => ({}) }))
vi.doMock('../../src/notifications/delivery-status', () => ({
  flushStoredBubblesDeliveryStatuses: native.flush,
  observeStoredBubblesNotificationReceived: async () => undefined,
  observeStoredBubblesNotificationClicked: async () => undefined,
  observeStoredBubblesLocalDisplayRequested: async () => undefined
}))

const { BubblesNotificationsProvider } = await import('../../src/runtime/BubblesNotificationsProvider')
const { BubblesNotificationsContext } = await import('../../src/runtime/context')

const roots: ReactTestRenderer[] = []
const contexts = new Map<string, BubblesNotificationsContextValue>()
const config = { appId: 'app', appKey: 'key', apiBaseUrl: 'https://backend.example' }

function Consumer ({ name }: { name: string }) {
  contexts.set(name, required(useContext(BubblesNotificationsContext)))

  return null
}
function tree (name: string, props: Partial<BubblesNotificationsProviderProps> = {}) {
  return <BubblesNotificationsProvider
    {...config}
    {...props}
  ><Consumer name={name} /></BubblesNotificationsProvider>
}
async function settle () {
  await act(async () => {
    await vi.dynamicImportSettled()
    await import('@react-native-firebase/messaging')
    await import('../../src/runtime/foreground-message-observer')
    for (let index = 0; index < 35; index++) await Promise.resolve()
  })
}
async function mount (name: string, props: Partial<BubblesNotificationsProviderProps> = {}, strict = false) {
  let root!: ReactTestRenderer

  await act(async () => { root = create(strict ? <StrictMode>{tree(name, props)}</StrictMode> : tree(name, props)) })
  roots.push(root)
  await settle()

  return root
}
async function unmount (root: ReactTestRenderer) {
  await act(async () => { root.unmount() })
  roots.splice(roots.indexOf(root), 1)
  await settle()
}
function assertListeners (count: number) {
  assert.deepEqual([native.messages.size, native.responses.size, native.tokens.size, native.appStates.size], [count, count, count, count])
}
function emit (listeners: Set<Listener>, value: unknown) {
  for (const listener of [...listeners]) listener(value as never)
}
let sequence = 0

function open () {
  const id = `open-${++sequence}`

  return { notification: { request: { identifier: id, content: { data: { notification_id: id } } } } }
}
beforeEach(async () => {
  await import('@react-native-firebase/messaging')
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  native.stored = { deviceId: null, apiBaseUrl: null, appKey: null }
  native.lastResponse = null
  native.currentState = 'active'
  native.sync.mockReset().mockImplementation(async () => ({ action: 'created', deviceId: CURRENT_DEVICE_ID }))
  native.flush.mockReset().mockResolvedValue(undefined)
  native.token.mockClear()
  native.prepare.mockClear()
  native.client.mockClear()
  native.mark.mockClear()
  native.bind.mockClear()
  native.schedule.mockClear()
  native.update.mockReset().mockResolvedValue(undefined)
  contexts.clear()
})
afterEach(async () => {
  for (const root of [...roots]) await unmount(root)
  assertListeners(0)
})

test('sequential replacement and final cleanup allow a later mount', async () => {
  const first = await mount('first')

  assertListeners(1)
  await unmount(first)
  assertListeners(0)
  const second = await mount('second')

  assertListeners(1)
  await unmount(second)
  await mount('third')
  assertListeners(1)
})

test('keyed replacement in one root uses current response callback and presentation', async () => {
  const oldCallback = vi.fn()
  const currentCallback = vi.fn()
  const root = await mount('first', { onNotificationResponse: oldCallback })

  await act(async () => { root.update(<BubblesNotificationsProvider
    key='replacement'
    {...config}
    foregroundPresentation={{ shouldPlaySound: true }}
    onNotificationResponse={currentCallback}
  ><Consumer name='second' /></BubblesNotificationsProvider>) })
  await settle()
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(oldCallback.mock.calls.length, 0)
  assert.equal(currentCallback.mock.calls.length, 1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
})

for (const oldFirst of [true, false]) {
  test(`independent roots hand over all native listeners, cleanup old first=${oldFirst}`, async () => {
    const oldCallback = vi.fn()
    const currentCallback = vi.fn()
    const oldRoot = await mount('old', { onNotificationResponse: oldCallback })
    const staleResponseListener = [...native.responses][0]
    const currentRoot = await mount('current', { onNotificationResponse: currentCallback, foregroundPresentation: { shouldPlaySound: true } })

    assertListeners(1)
    const response = open()

    staleResponseListener(response as never)
    emit(native.responses, response)
    emit(native.responses, response)
    emit(native.messages, { notification: { title: 'One presentation', body: 'Body' }, data: {} })
    await settle()
    assert.equal(native.schedule.mock.calls.length, 1)
    assert.equal(oldCallback.mock.calls.length, 0)
    assert.equal(currentCallback.mock.calls.length, 1)
    assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
    await unmount(oldFirst ? oldRoot : currentRoot)
    assertListeners(oldFirst ? 1 : 0)
    if (oldFirst) {
      emit(native.responses, open())
      assert.equal(currentCallback.mock.calls.length, 2)
    }
    await unmount(oldFirst ? currentRoot : oldRoot)
    assertListeners(0)
  })
}

// Node 22 with Vitest's forks pool can bypass native module mocks during
// React's immediate effect replay. The test script uses the threads pool.
test('Strict Mode effect replay leaves exactly one active runtime', async () => {
  const callback = vi.fn()

  await mount('strict', { onNotificationResponse: callback }, true)
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(callback.mock.calls.length, 1)
  await act(async () => { await required(contexts.get('strict')).registerDevice({ userId: 'strict-user' }) })
  assert.equal(native.sync.mock.calls.length, 1)
})

test('deferred enrollment drains before replacement enrollment and cannot acknowledge stale state', async () => {
  let release!: (value: { action: string; deviceId: string }) => void
  const deferred = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })

  native.sync.mockImplementationOnce(() => deferred)
  await mount('old')
  let oldRegistration!: Promise<void>

  await act(async () => { oldRegistration = required(contexts.get('old')).registerDevice({ userId: 'old-user' }); void oldRegistration.catch(() => undefined) })
  await settle()
  assert.equal(native.sync.mock.calls.length, 1)
  const oldContext = required(contexts.get('old'))

  await mount('current')
  let currentRegistration!: Promise<void>

  await act(async () => { currentRegistration = required(contexts.get('current')).registerDevice({ userId: 'current-user' }) })
  assert.equal(native.sync.mock.calls.length, 1)
  assert.equal(required(contexts.get('current')).notificationsEnabled, false)
  await act(async () => { release({ action: 'created', deviceId: 'stale-device' }); await Promise.allSettled([oldRegistration, currentRegistration]) })
  await settle()
  assert.equal(native.sync.mock.calls.length, 2)
  assert.deepEqual(native.sync.mock.calls.map(([options]) => options.userId), ['old-user', 'current-user'])
  assert.equal(native.stored.deviceId, CURRENT_DEVICE_ID)
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  await assert.rejects(oldContext.registerDevice({ userId: 'stale-user' }))
  assert.equal(native.sync.mock.calls.length, 2)
})

test('incompatible overlapping credentials fail explicitly without disabling the active root', async () => {
  const callback = vi.fn()

  await mount('current', { onNotificationResponse: callback })
  await assert.rejects(mount('conflict', { appKey: 'different-key' }), /configur|conflict|credential/i)
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(callback.mock.calls.length, 1)
})

test('equivalent inline migration options retain current listeners and presentation on rerender', async () => {
  const callback = vi.fn()
  const root = await mount('current', { oneSignalMigration: { policy: 'disabled' }, onNotificationResponse: callback, foregroundPresentation: { shouldPlaySound: true } })

  await act(async () => { root.update(tree('current', { oneSignalMigration: { policy: 'disabled' }, onNotificationResponse: callback, foregroundPresentation: { shouldPlaySound: true } })) })
  await settle()
  assertListeners(1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
  emit(native.responses, open())
  assert.equal(callback.mock.calls.length, 1)
})

test('retired provider rerenders cannot reacquire listeners or overwrite current presentation', async () => {
  const staleCallback = vi.fn()
  const callback = vi.fn()
  const old = await mount('old', { onNotificationResponse: staleCallback })

  await mount('current', { onNotificationResponse: callback, foregroundPresentation: { shouldPlaySound: true } })
  await act(async () => { old.update(tree('old', { appKey: 'retired-changed-key', onNotificationResponse: staleCallback, foregroundPresentation: { shouldPlaySound: false } })) })
  await settle()
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(staleCallback.mock.calls.length, 0)
  assert.equal(callback.mock.calls.length, 1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
})

test('current provider configuration updates retain presentation and retire stale enrollment', async () => {
  const root = await mount('current', { foregroundPresentation: { shouldPlaySound: true } })

  await act(async () => { root.update(tree('current', { appKey: 'rotated-key', foregroundPresentation: { shouldPlaySound: true } })) })
  await settle()
  assertListeners(1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
  await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'new-user' }) })
  assert.equal(native.sync.mock.calls[native.sync.mock.calls.length - 1]?.[0].appKey, 'rotated-key')
})

function acknowledgeStoredDevice () {
  native.stored = {
    ...config,
    deviceId: ACKNOWLEDGED_DEVICE_ID,
    registrationScope: `${config.apiBaseUrl}/${config.appId}`,
    identityAcknowledged: true,
    acknowledgedInstallationId: 'installation',
    oneSignalAppId: 'migration-app',
    oneSignalSubscriptionId: 'legacy-subscription'
  }
}

function migrationConfiguration (readinessTimeoutMs?: number) {
  return {
    policy: 'required' as const,
    oneSignalAppId: 'migration-app',
    bridge: { getSubscriptionId: async () => 'legacy-subscription', subscribe: (_listener: (id: string | null) => void) => () => undefined },
    readinessTimeoutMs
  }
}

test('a deferred bootstrap delivery flush does not block enrollment, logout, or replacement startup', async () => {
  acknowledgeStoredDevice()
  let release!: () => void
  const deferred = new Promise<void>((resolve) => { release = resolve })
  const operations: Promise<unknown>[] = []

  native.flush.mockImplementationOnce(() => deferred)
  try {
    await mount('old')
    assert.equal(native.flush.mock.calls.length, 1)
    let registered = false
    let loggedOut = false

    await act(async () => {
      operations.push(required(contexts.get('old')).registerDevice({ userId: 'flush-user' }).then(() => { registered = true }))
    })
    await settle()
    assert.equal(registered, true, 'a best-effort delivery flush must not hold enrollment')
    assert.equal(native.sync.mock.calls.length, 1)
    await act(async () => {
      operations.push(required(contexts.get('old')).logout().then(() => { loggedOut = true }))
    })
    await settle()
    assert.equal(loggedOut, true, 'a best-effort delivery flush must not hold logout')
    assert.equal(native.update.mock.calls.length, 1)
    const preparedBeforeReplacement = native.prepare.mock.calls.length

    await mount('replacement')
    assert.ok(native.prepare.mock.calls.length > preparedBeforeReplacement, 'replacement startup must proceed before the flush resolves')
    assertListeners(1)
  } finally {
    await act(async () => { release(); await Promise.allSettled(operations) })
    await settle()
  }
})

test('an omitted migration timeout and explicit default retain the enrolled session and maintenance', async () => {
  acknowledgeStoredDevice()
  const migration = migrationConfiguration()
  const root = await mount('current', { oneSignalMigration: migration })

  await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'migration-user' }) })
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  const tokenReads = native.token.mock.calls.length

  await act(async () => { root.update(tree('current', { oneSignalMigration: { ...migration, readinessTimeoutMs: 3000 } })) })
  await settle()
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  emit(native.tokens, 'refreshed-token')
  await settle()
  assert.ok(native.token.mock.calls.length > tokenReads, 'the original enrolled session must still receive maintenance')
  assertListeners(1)
})

for (const changed of ['bridge', 'appId', 'timeout'] as const) {
  test(`changing required migration ${changed} immediately suspends enabled session state`, async () => {
    acknowledgeStoredDevice()
    const migration = migrationConfiguration(1000)
    const root = await mount('current', { oneSignalMigration: migration })

    await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'migration-user' }) })
    assert.equal(required(contexts.get('current')).notificationsEnabled, true)
    const nextMigration = {
      ...migration,
      ...(changed === 'bridge' ? { bridge: migrationConfiguration().bridge } : {}),
      ...(changed === 'appId' ? { oneSignalAppId: 'replacement-migration-app' } : {}),
      ...(changed === 'timeout' ? { readinessTimeoutMs: 2000 } : {})
    }

    await act(async () => { root.update(tree('current', { oneSignalMigration: nextMigration })) })
    assert.equal(required(contexts.get('current')).notificationsEnabled, false)
    await settle()
    assertListeners(1)
  })
}

test('migration changes invalidate deferred enrollment while eventually clearing syncing state', async () => {
  acknowledgeStoredDevice()
  const migration = migrationConfiguration(1000)
  const root = await mount('current', { oneSignalMigration: migration })
  let release!: (value: { action: string; deviceId: string }) => void
  const deferred = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })
  let registration!: Promise<void>

  native.sync.mockImplementationOnce(() => deferred)
  try {
    await act(async () => {
      registration = required(contexts.get('current')).registerDevice({ userId: 'deferred-migration-user' })
      void registration.catch(() => undefined)
    })
    await settle()
    assert.equal(native.sync.mock.calls.length, 1)
    assert.equal(required(contexts.get('current')).isSyncing, true)
    await act(async () => { root.update(tree('current', { oneSignalMigration: { ...migration, readinessTimeoutMs: 2000 } })) })
  } finally {
    await act(async () => { release({ action: 'created', deviceId: 'stale-migration-device' }); await Promise.allSettled([registration]) })
    await settle()
  }
  assert.equal(native.stored.deviceId, ACKNOWLEDGED_DEVICE_ID)
  assert.equal(required(contexts.get('current')).notificationsEnabled, false)
  assert.equal(required(contexts.get('current')).isSyncing, false)
})

test('logout during the first enrollment disables its canonical result even after provider handover', async () => {
  let release!: (value: { action: string; deviceId: string }) => void
  const deferred = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })
  let registration!: Promise<void>
  let logout!: Promise<void>

  native.sync.mockImplementationOnce(() => deferred)
  await mount('old')
  try {
    await act(async () => {
      registration = required(contexts.get('old')).registerDevice({ userId: 'outgoing-user' })
      void registration.catch(() => undefined)
    })
    await settle()
    assert.equal(native.sync.mock.calls.length, 1)
    await act(async () => { logout = required(contexts.get('old')).logout() })
    await settle()
    assert.equal(native.stored.pendingLogouts?.[`${config.apiBaseUrl}/${config.appId}`], null)
    await mount('replacement')
    assertListeners(1)
  } finally {
    await act(async () => { release({ action: 'created', deviceId: 'outgoing-canonical-device' }); await Promise.allSettled([registration, logout]) })
    await settle()
  }
  assert.deepEqual(native.update.mock.calls.map(([deviceId, attributes]) => ({ deviceId, attributes })), [{ deviceId: 'outgoing-canonical-device', attributes: { notifications_enabled: false } }])
  assert.equal(native.stored.deviceId, null)
  assert.equal(native.stored.identityAcknowledged, undefined)
  assert.deepEqual(native.stored.pendingLogouts, {})
  assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
  await act(async () => { await required(contexts.get('replacement')).registerDevice({ userId: 'replacement-user' }) })
  assert.equal(native.stored.deviceId, CURRENT_DEVICE_ID)
  assert.equal(required(contexts.get('replacement')).notificationsEnabled, true)
})

test('retired registration preserves its error and queued logout attempts disable once before startup retries', async () => {
  const canonicalDeviceId = 'retired-canonical-device'
  const disableError = new Error('Disable temporarily unavailable')
  let release!: (value: { action: string; deviceId: string }) => void
  const response = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })
  let registration!: Promise<void>
  let logout!: Promise<void>
  let results!: PromiseSettledResult<void>[]

  native.sync.mockImplementationOnce(() => response)
  native.update.mockRejectedValueOnce(disableError)
  const root = await mount('old')

  try {
    await act(async () => {
      registration = required(contexts.get('old')).registerDevice({ userId: 'outgoing-user' })
      void registration.catch(() => undefined)
    })
    await settle()
    assert.equal(native.sync.mock.calls.length, 1)
    await act(async () => {
      logout = required(contexts.get('old')).logout()
      void logout.catch(() => undefined)
    })
    await unmount(root)
  } finally {
    await act(async () => {
      release({ action: 'created', deviceId: canonicalDeviceId })
      results = await Promise.allSettled([registration, logout])
    })
    await settle()
  }
  assert.equal(results[0].status, 'rejected')
  if (results[0].status === 'rejected') assert.match(String(results[0].reason), /Registration configuration changed/)
  assert.deepEqual(results[1], { status: 'rejected', reason: disableError })
  assert.deepEqual(native.update.mock.calls.map(([deviceId, attributes]) => [deviceId, attributes]), [[canonicalDeviceId, { notifications_enabled: false }]])
  const scope = `${config.apiBaseUrl}/${config.appId}`

  assert.equal(native.stored.pendingLogouts?.[scope], canonicalDeviceId)
  assert.equal(native.stored.deviceId, null)
  assertListeners(0)
  await mount('replacement')
  assert.deepEqual(native.update.mock.calls.map(([deviceId, attributes]) => [deviceId, attributes]), [
    [canonicalDeviceId, { notifications_enabled: false }],
    [canonicalDeviceId, { notifications_enabled: false }]
  ])
  assert.deepEqual(native.stored.pendingLogouts, {})
  assertListeners(1)
})

test('replacement enrollment waits for the outgoing canonical disable request to complete', async () => {
  const departingDeviceId = 'departing-canonical-device'
  let releaseEnrollment!: (value: { action: string; deviceId: string }) => void
  let releaseDisable!: () => void
  const enrollment = new Promise<{ action: string; deviceId: string }>((resolve) => { releaseEnrollment = resolve })
  const disable = new Promise<void>((resolve) => { releaseDisable = resolve })
  const operations: Promise<unknown>[] = []

  native.sync.mockImplementationOnce(() => enrollment)
  native.update.mockImplementationOnce(() => disable)
  await mount('old')
  try {
    await act(async () => {
      const registration = required(contexts.get('old')).registerDevice({ userId: 'departing-user' })

      void registration.catch(() => undefined)
      operations.push(registration)
    })
    await settle()
    await act(async () => { operations.push(required(contexts.get('old')).logout()) })
    await mount('replacement')
    await act(async () => {
      operations.push(required(contexts.get('replacement')).registerDevice({ userId: 'incoming-user' }))
      releaseEnrollment({ action: 'created', deviceId: departingDeviceId })
    })
    await settle()
    assert.equal(native.update.mock.calls.length, 1)
    assert.equal(native.update.mock.calls[0][0], departingDeviceId)
    assert.equal(native.sync.mock.calls.length, 1, 'the replacement POST must wait for the old identity to be disabled')
    assert.equal(native.stored.deviceId, null)
    assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
  } finally {
    await act(async () => {
      releaseEnrollment({ action: 'created', deviceId: departingDeviceId })
      releaseDisable()
      await Promise.allSettled(operations)
    })
    await settle()
  }
  assert.equal(native.sync.mock.calls.length, 2)
  assert.equal(native.stored.deviceId, CURRENT_DEVICE_ID)
  assert.equal(required(contexts.get('replacement')).notificationsEnabled, true)
})

test('a rejected provider cannot enroll work queued by a descendant layout effect', async () => {
  const currentCallback = vi.fn()
  let rejectedRegistration: Promise<void> | undefined

  function EnrollOnCommit () {
    const context = required(useContext(BubblesNotificationsContext))

    useLayoutEffect(() => {
      rejectedRegistration = context.registerDevice({ userId: 'rejected-user' })
      void rejectedRegistration.catch(() => undefined)
    }, [context])

    return null
  }

  await mount('current', { onNotificationResponse: currentCallback })
  const preparesBeforeRejectedCommit = native.prepare.mock.calls.length

  await assert.rejects(async () => {
    await act(async () => {
      create(<BubblesNotificationsProvider
        {...config}
        appKey='conflicting-key'
      ><EnrollOnCommit /></BubblesNotificationsProvider>)
    })
  }, /configur|conflict|credential/i)
  assert.ok(rejectedRegistration, 'the descendant layout effect must queue its enrollment before ownership is rejected')
  await act(async () => { await Promise.allSettled([rejectedRegistration]) })
  await settle()
  assert.equal(native.sync.mock.calls.length, 0)
  assert.equal(native.prepare.mock.calls.length, preparesBeforeRejectedCommit)
  assert.equal(native.stored.appKey, config.appKey)
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(currentCallback.mock.calls.length, 1)
  await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'accepted-user' }) })
  assert.equal(native.sync.mock.calls.length, 1)
})

for (const transition of ['unmount', 'scope change'] as const) {
  test(`queued logout disables the original identity after ${transition}`, async () => {
    acknowledgeStoredDevice()
    const root = await mount('current')

    await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'logged-in-user' }) })
    let releaseMaintenance!: (token: string) => void
    const maintenanceToken = new Promise<string>((resolve) => { releaseMaintenance = resolve })
    let logout: Promise<void> | undefined

    native.token.mockImplementationOnce(() => maintenanceToken)
    try {
      emit(native.tokens, 'maintenance-token')
      await settle()
      assert.equal(required(contexts.get('current')).isSyncing, true)
      await act(async () => { logout = required(contexts.get('current')).logout() })
      await settle()
      assert.equal(native.update.mock.calls.length, 0)
      if (transition === 'unmount') {
        await unmount(root)
        assertListeners(0)
      } else {
        await act(async () => { root.update(tree('current', { apiBaseUrl: 'https://replacement-backend.example', appId: 'replacement-app' })) })
        await settle()
        assertListeners(1)
      }
    } finally {
      await act(async () => { releaseMaintenance('maintenance-token'); await logout })
      await settle()
    }
    assert.deepEqual(native.update.mock.calls.map(([deviceId, attributes]) => ({ deviceId, attributes })), [{ deviceId: CURRENT_DEVICE_ID, attributes: { notifications_enabled: false } }])
    assert.deepEqual(native.client.mock.calls[0][0], { baseUrl: config.apiBaseUrl, appKey: config.appKey })
    assert.deepEqual(native.stored.pendingLogouts, {})
    if (transition === 'scope change') {
      await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'replacement-scope-user' }) })
      assert.equal(native.sync.mock.calls[1][0].apiBaseUrl, 'https://replacement-backend.example')
      assert.equal(required(contexts.get('current')).notificationsEnabled, true)
    }
  })
}

test('logout retargets an acknowledged identity to its recovered canonical result after handover', async () => {
  const recoveredDeviceId = 'recovered-canonical-device'

  acknowledgeStoredDevice()
  let release!: (value: { action: string; deviceId: string }) => void
  const deferred = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })
  const operations: Promise<unknown>[] = []

  native.sync.mockImplementationOnce(() => deferred)
  await mount('old')
  try {
    await act(async () => {
      const registration = required(contexts.get('old')).registerDevice({ userId: 'recovered-user' })

      void registration.catch(() => undefined)
      operations.push(registration)
    })
    await settle()
    assert.equal(native.sync.mock.calls[0][0].deviceId, ACKNOWLEDGED_DEVICE_ID)
    await act(async () => { operations.push(required(contexts.get('old')).logout()) })
    await settle()
    assert.equal(native.stored.pendingLogouts?.[`${config.apiBaseUrl}/${config.appId}`], ACKNOWLEDGED_DEVICE_ID)
    await mount('replacement')
  } finally {
    await act(async () => { release({ action: 'created', deviceId: recoveredDeviceId }); await Promise.allSettled(operations) })
    await settle()
  }
  assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [recoveredDeviceId])
  assert.equal(native.stored.deviceId, ACKNOWLEDGED_DEVICE_ID)
  assert.deepEqual(native.stored.pendingLogouts, {})
  assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
})

function LogoutOnCommit ({ onLogout }: { onLogout: (operation: Promise<void>) => void }) {
  const context = required(useContext(BubblesNotificationsContext))
  const started = useRef(false)

  useLayoutEffect(() => {
    if (started.current) return
    started.current = true
    const operation = context.logout()

    void operation.catch(() => undefined)
    onLogout(operation)
  }, [context, onLogout])

  return null
}

test('a migration-incompatible provider cannot persist or disable logout from a descendant layout effect', async () => {
  acknowledgeStoredDevice()
  const callback = vi.fn()
  const migration = migrationConfiguration()

  await mount('current', { oneSignalMigration: migration, onNotificationResponse: callback })
  await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'current-owner-user' }) })
  const storedBeforeRejectedCommit = structuredClone(native.stored)
  const preparesBeforeRejectedCommit = native.prepare.mock.calls.length
  let rejectedLogout: Promise<void> | undefined

  await assert.rejects(async () => {
    await act(async () => {
      create(<BubblesNotificationsProvider
        {...config}
        oneSignalMigration={{ ...migration, readinessTimeoutMs: 1000 }}
      >
        <LogoutOnCommit onLogout={(operation) => { rejectedLogout = operation }} />
      </BubblesNotificationsProvider>)
    })
  }, /configur|conflict|credential/i)
  assert.ok(rejectedLogout, 'the descendant layout effect must call logout before rejected ownership acquisition')
  await assert.rejects(required(rejectedLogout), /replac|unmount|owner|accept|acquir/i)
  await settle()
  assert.equal(native.mark.mock.calls.length, 0)
  assert.equal(native.update.mock.calls.length, 0)
  assert.equal(native.prepare.mock.calls.length, preparesBeforeRejectedCommit)
  assert.deepEqual(native.stored, storedBeforeRejectedCommit)
  assertListeners(1)
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  emit(native.responses, open())
  assert.equal(callback.mock.calls.length, 1)
  const tokenReads = native.token.mock.calls.length

  emit(native.tokens, 'still-current-token')
  await settle()
  assert.ok(native.token.mock.calls.length > tokenReads)
})

for (const replacement of [false, true]) {
  for (const immediatelyUnmounted of [false, true]) {
    test(`accepted descendant layout logout persists and disables, replacement=${replacement}, immediate unmount=${immediatelyUnmounted}`, async () => {
      acknowledgeStoredDevice()
      if (replacement) {
        await mount('old')
        await act(async () => { await required(contexts.get('old')).registerDevice({ userId: 'old-owner-user' }) })
      }
      const expectedDeviceId = replacement ? CURRENT_DEVICE_ID : ACKNOWLEDGED_DEVICE_ID
      let logout: Promise<void> | undefined
      let root!: ReactTestRenderer

      act(() => {
        root = create(<BubblesNotificationsProvider {...config}>
          <LogoutOnCommit onLogout={(operation) => { logout = operation }} />
        </BubblesNotificationsProvider>)
      })
      if (immediatelyUnmounted) {
        act(() => { root.unmount() })
      } else {
        roots.push(root)
      }
      assert.ok(logout)
      await act(async () => { await logout })
      await settle()
      assert.ok(native.mark.mock.calls.length > 0)
      assert.deepEqual(native.update.mock.calls.map(([deviceId, attributes]) => ({ deviceId, attributes })), [{ deviceId: expectedDeviceId, attributes: { notifications_enabled: false } }])
      assert.deepEqual(native.stored.pendingLogouts, {})
      assertListeners(immediatelyUnmounted ? 0 : 1)
    })
  }
}

for (const existingIdentity of [false, true]) {
  test(`replacement layout logout preserves a canonical response queued before its commit, existing identity=${existingIdentity}`, async () => {
    const canonicalDeviceId = 'response-before-handover-canonical'

    if (existingIdentity) acknowledgeStoredDevice()
    let releaseResponse!: (value: { action: string; deviceId: string }) => void
    const response = new Promise<{ action: string; deviceId: string }>((resolve) => { releaseResponse = resolve })
    let registration: Promise<void> | undefined
    let logout: Promise<void> | undefined

    native.sync.mockImplementationOnce(() => response)
    await mount('old')
    try {
      await act(async () => {
        registration = required(contexts.get('old')).registerDevice({ userId: 'response-race-user' })
        void registration.catch(() => undefined)
      })
      await settle()
      assert.equal(native.sync.mock.calls.length, 1)
      assert.equal(native.sync.mock.calls[0][0].deviceId, existingIdentity ? ACKNOWLEDGED_DEVICE_ID : null)
      // Resolve the exact I/O promise awaited by sync-device, queuing its
      // continuation before the child's pre-acquisition logout can queue a mark.
      // A synchronous React commit then retires that registration in this turn.
      act(() => {
        releaseResponse({ action: 'created', deviceId: canonicalDeviceId })
        const replacement = create(<BubblesNotificationsProvider {...config}>
          <LogoutOnCommit onLogout={(operation) => { logout = operation }} />

          <Consumer name='replacement' />
        </BubblesNotificationsProvider>)

        roots.push(replacement)
      })
      assert.ok(logout, 'the compatible replacement must commit synchronously before any queued continuation runs')
    } finally {
      await act(async () => {
        releaseResponse({ action: 'created', deviceId: canonicalDeviceId })
        await Promise.allSettled([registration, logout])
      })
      await settle()
    }
    assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [canonicalDeviceId])
    assert.ok(native.mark.mock.invocationCallOrder[0] < native.bind.mock.invocationCallOrder[0], 'accepted replacement must persist logout before stale canonical binding')
    assert.equal(native.stored.deviceId, existingIdentity ? ACKNOWLEDGED_DEVICE_ID : null)
    assert.deepEqual(native.stored.pendingLogouts, {})
    assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
    assertListeners(1)
  })
}

function EnrollFromLayout ({ userId, onOperation }: { userId: string; onOperation: (operation: Promise<void>) => void }) {
  const context = required(useContext(BubblesNotificationsContext))
  const currentContext = useRef(context)

  useLayoutEffect(() => { currentContext.current = context }, [context])
  useLayoutEffect(() => {
    const operation = currentContext.current.registerDevice({ userId })

    void operation.catch(() => undefined)
    onOperation(operation)
  }, [userId, onOperation])

  return null
}

test('Strict Mode replay enrolls the latest descendant layout request exactly once', async () => {
  const operations: Promise<void>[] = []
  const onOperation = (operation: Promise<void>) => { operations.push(operation) }
  let root!: ReactTestRenderer

  await act(async () => {
    root = create(<StrictMode><BubblesNotificationsProvider {...config}>
      <EnrollFromLayout
        userId='strict-layout-user'
        onOperation={onOperation}
      />

      <Consumer name='current' />
    </BubblesNotificationsProvider></StrictMode>)
  })
  roots.push(root)
  await act(async () => { await Promise.allSettled(operations) })
  await settle()
  assert.equal(operations.length, 2, 'React must replay the descendant layout enrollment')
  assert.deepEqual(native.sync.mock.calls.map(([options]) => ({ userId: options.userId, apiBaseUrl: options.apiBaseUrl, appKey: options.appKey })), [{ userId: 'strict-layout-user', apiBaseUrl: config.apiBaseUrl, appKey: config.appKey }])
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  assertListeners(1)
})

test('descendant layout enrollment after a configuration change uses the current user and credentials', async () => {
  const operations: Promise<void>[] = []
  const onOperation = (operation: Promise<void>) => { operations.push(operation) }
  let root!: ReactTestRenderer

  await act(async () => {
    root = create(<BubblesNotificationsProvider {...config}>
      <EnrollFromLayout
        userId='before-layout-change'
        onOperation={onOperation}
      />

      <Consumer name='current' />
    </BubblesNotificationsProvider>)
  })
  roots.push(root)
  await act(async () => { await Promise.allSettled(operations) })
  await settle()
  assert.equal(native.sync.mock.calls.length, 1)
  await act(async () => {
    root.update(<BubblesNotificationsProvider
      {...config}
      apiBaseUrl='https://layout-change.example'
      appKey='layout-change-key'
    >
      <EnrollFromLayout
        userId='after-layout-change'
        onOperation={onOperation}
      />

      <Consumer name='current' />
    </BubblesNotificationsProvider>)
  })
  await act(async () => { await Promise.allSettled(operations) })
  await settle()
  assert.deepEqual(native.sync.mock.calls.map(([options]) => ({ userId: options.userId, apiBaseUrl: options.apiBaseUrl, appKey: options.appKey })), [
    { userId: 'before-layout-change', apiBaseUrl: config.apiBaseUrl, appKey: config.appKey },
    { userId: 'after-layout-change', apiBaseUrl: 'https://layout-change.example', appKey: 'layout-change-key' }
  ])
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  assertListeners(1)
})

for (const migrationChange of ['bridge', 'timeout'] as const) {
  test(`pending logout retries after migration ${migrationChange} changes without external events`, async () => {
    acknowledgeStoredDevice()
    const migration = migrationConfiguration(1000)
    const root = await mount('current', { oneSignalMigration: migration })

    await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'retry-migration-user' }) })
    vi.useFakeTimers()
    try {
      native.update.mockRejectedValueOnce(new Error('Temporary disable failure'))
      await act(async () => {
        await assert.rejects(required(contexts.get('current')).logout(), /Temporary disable failure/)
      })
      assert.equal(native.update.mock.calls.length, 1)
      assert.equal(native.stored.pendingLogouts?.[`${config.apiBaseUrl}/${config.appId}`], CURRENT_DEVICE_ID)
      const nextMigration = {
        ...migration,
        ...(migrationChange === 'bridge' ? { bridge: migrationConfiguration().bridge } : { readinessTimeoutMs: 2000 })
      }

      await act(async () => { root.update(tree('current', { oneSignalMigration: nextMigration })) })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15000)
        for (let index = 0; index < 35; index++) await Promise.resolve()
      })
      assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [CURRENT_DEVICE_ID, CURRENT_DEVICE_ID])
      assert.deepEqual(native.stored.pendingLogouts, {})
      assert.equal(required(contexts.get('current')).notificationsEnabled, false)
      assert.equal(native.sync.mock.calls.length, 1, 'logout retry must not enroll a new session')
    } finally {
      vi.useRealTimers()
    }
    await settle()
    assertListeners(1)
  })
}

test('a later child layout logout wins over initial enrollment waiting for ownership', async () => {
  acknowledgeStoredDevice()
  const operations: Promise<void>[] = []

  function EnrollThenLogout () {
    const context = required(useContext(BubblesNotificationsContext))
    const started = useRef(false)

    useLayoutEffect(() => {
      if (started.current) return
      started.current = true
      const registration = context.registerDevice({ userId: 'signed-out-before-acquisition' })
      const logout = context.logout()

      void registration.catch(() => undefined)
      void logout.catch(() => undefined)
      operations.push(registration, logout)
    }, [context])

    return null
  }

  let root!: ReactTestRenderer

  await act(async () => {
    root = create(<BubblesNotificationsProvider {...config}>
      <EnrollThenLogout />

      <Consumer name='current' />
    </BubblesNotificationsProvider>)
  })
  roots.push(root)
  let results: PromiseSettledResult<void>[] = []

  await act(async () => { results = await Promise.allSettled(operations) })
  await settle()
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled'])
  assert.equal(native.sync.mock.calls.length, 0, 'the initial enrollment must not start after the later logout')
  assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [ACKNOWLEDGED_DEVICE_ID])
  assert.deepEqual(native.stored.pendingLogouts, {})
  assert.equal(required(contexts.get('current')).notificationsEnabled, false)
  assertListeners(1)
})

function LogoutFromLayout ({ onOperation }: { onOperation: (operation: Promise<void>) => void }) {
  const context = required(useContext(BubblesNotificationsContext))
  const currentContext = useRef(context)

  useLayoutEffect(() => { currentContext.current = context }, [context])
  useLayoutEffect(() => {
    const operation = currentContext.current.logout()

    void operation.catch(() => undefined)
    onOperation(operation)
  }, [onOperation])

  return null
}

for (const configurationChange of ['migration', 'credentials', 'backend scope'] as const) {
  test(`descendant layout logout after ${configurationChange} change uses the accepted configuration`, async () => {
    acknowledgeStoredDevice()
    const migration = migrationConfiguration(1000)
    const root = await mount('current', { oneSignalMigration: migration })

    await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'before-layout-logout' }) })
    const changingBackendScope = configurationChange === 'backend scope'
    const nextConfiguration = {
      ...config,
      ...(configurationChange === 'credentials' ? { appKey: 'layout-logout-new-key' } : {}),
      ...(changingBackendScope ? { apiBaseUrl: 'https://layout-logout-backend.example', appId: 'layout-logout-app' } : {})
    }
    const nextMigration = configurationChange === 'migration' ? { ...migration, readinessTimeoutMs: 2000 } : migration
    const expectedDeviceId = changingBackendScope ? 'new-scope-logout-device' : CURRENT_DEVICE_ID

    // Model the binding selected by the newly committed backend/app scope.
    // The provider's current-device ref still contains the outgoing binding.
    if (changingBackendScope) {
      native.stored = {
        ...native.stored,
        apiBaseUrl: nextConfiguration.apiBaseUrl,
        appKey: nextConfiguration.appKey,
        registrationScope: `${nextConfiguration.apiBaseUrl}/${nextConfiguration.appId}`,
        deviceId: expectedDeviceId
      }
    }
    const operations: Promise<void>[] = []
    const onOperation = (operation: Promise<void>) => { operations.push(operation) }

    await act(async () => {
      root.update(<BubblesNotificationsProvider
        {...nextConfiguration}
        oneSignalMigration={nextMigration}
      >
        <LogoutFromLayout onOperation={onOperation} />

        <Consumer name='current' />
      </BubblesNotificationsProvider>)
    })
    let results: PromiseSettledResult<void>[] = []

    await act(async () => { results = await Promise.allSettled(operations) })
    await settle()
    assert.deepEqual(results.map((result) => result.status), ['fulfilled'])
    assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [expectedDeviceId])
    assert.deepEqual(native.client.mock.calls.map(([configuration]) => configuration), [{ baseUrl: nextConfiguration.apiBaseUrl, appKey: nextConfiguration.appKey }])
    assert.equal(native.mark.mock.calls[0][0], `${nextConfiguration.apiBaseUrl}/${nextConfiguration.appId}`)
    assert.deepEqual(native.stored.pendingLogouts, {})
    assert.equal(native.sync.mock.calls.length, 1, 'the layout logout must not re-enroll or enable an identity')
    assert.equal(required(contexts.get('current')).notificationsEnabled, false)
    assertListeners(1)
  })
}

test('Strict Mode descendant layout logout accepts both effect setups and disables once', async () => {
  acknowledgeStoredDevice()
  const operations: Promise<void>[] = []
  const onOperation = (operation: Promise<void>) => { operations.push(operation) }
  let root!: ReactTestRenderer

  await act(async () => {
    root = create(<StrictMode><BubblesNotificationsProvider {...config}>
      <LogoutFromLayout onOperation={onOperation} />

      <Consumer name='current' />
    </BubblesNotificationsProvider></StrictMode>)
  })
  roots.push(root)
  let results: PromiseSettledResult<void>[] = []

  await act(async () => { results = await Promise.allSettled(operations) })
  await settle()
  assert.equal(operations.length, 2)
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled'])
  assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [ACKNOWLEDGED_DEVICE_ID])
  assert.deepEqual(native.stored.pendingLogouts, {})
  assert.equal(native.sync.mock.calls.length, 0)
  assert.equal(required(contexts.get('current')).notificationsEnabled, false)
  assertListeners(1)
})

for (const ownerState of ['retired', 'unmounted'] as const) {
  test(`logout from an already ${ownerState} provider rejects without persisting intent`, async () => {
    acknowledgeStoredDevice()
    const oldRoot = await mount('old')

    await act(async () => { await required(contexts.get('old')).registerDevice({ userId: 'stale-logout-user' }) })
    const oldContext = required(contexts.get('old'))
    const callback = vi.fn()

    if (ownerState === 'retired') {
      await mount('current', { onNotificationResponse: callback })
    } else {
      await unmount(oldRoot)
    }
    const storedBeforeLogout = structuredClone(native.stored)

    await assert.rejects(oldContext.logout(), /replac|unmount|owner|acquir/i)
    await settle()
    assert.equal(native.mark.mock.calls.length, 0)
    assert.equal(native.update.mock.calls.length, 0)
    assert.deepEqual(native.stored, storedBeforeLogout)
    assertListeners(ownerState === 'retired' ? 1 : 0)
    if (ownerState === 'retired') {
      emit(native.responses, open())
      assert.equal(callback.mock.calls.length, 1)
    }
  })
}

for (const logoutLast of [false, true]) {
  test(`configuration-update layout commands preserve call order, logout last=${logoutLast}`, async () => {
    acknowledgeStoredDevice()
    const migration = migrationConfiguration(1000)
    const root = await mount('current', { oneSignalMigration: migration })

    await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'before-ordered-layout-update' }) })
    const operations: Promise<void>[] = []

    function OrderedLayoutCommands () {
      const context = required(useContext(BubblesNotificationsContext))
      const started = useRef(false)

      useLayoutEffect(() => {
        if (started.current) return
        started.current = true
        const register = () => context.registerDevice({ userId: 'after-ordered-layout-update' })
        const logout = () => context.logout()
        const commands = logoutLast ? [register, logout] : [logout, register]

        for (const command of commands) {
          const operation = command()

          void operation.catch(() => undefined)
          operations.push(operation)
        }
      }, [context])

      return null
    }

    await act(async () => {
      root.update(<BubblesNotificationsProvider
        {...config}
        oneSignalMigration={{ ...migration, readinessTimeoutMs: 2000 }}
      >
        <OrderedLayoutCommands />

        <Consumer name='current' />
      </BubblesNotificationsProvider>)
    })
    let results: PromiseSettledResult<void>[] = []

    await act(async () => { results = await Promise.allSettled(operations) })
    await settle()
    assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'fulfilled'])
    assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [CURRENT_DEVICE_ID])
    assert.deepEqual(native.stored.pendingLogouts, {})
    assert.equal(native.sync.mock.calls.length, logoutLast ? 1 : 2)
    if (!logoutLast) assert.equal(native.sync.mock.calls[1][0].userId, 'after-ordered-layout-update')
    assert.equal(required(contexts.get('current')).notificationsEnabled, !logoutLast)
    assertListeners(1)
  })
}

test('a repeated logout from stale provider state keeps retrying the recovered canonical identity', async () => {
  const canonicalDeviceId = 'repeated-logout-canonical-device'
  const disableError = new Error('Canonical disable is temporarily unavailable')

  acknowledgeStoredDevice()
  const migration = migrationConfiguration(1000)
  const root = await mount('current', { oneSignalMigration: migration })
  let release!: (value: { action: string; deviceId: string }) => void
  const response = new Promise<{ action: string; deviceId: string }>((resolve) => { release = resolve })
  const operations: Promise<void>[] = []

  native.sync.mockImplementationOnce(() => response)
  native.update.mockImplementation(async (deviceId) => {
    if (deviceId === canonicalDeviceId) throw disableError
    throw Object.assign(new Error('The obsolete device no longer exists'), { status: 404 })
  })
  try {
    await act(async () => {
      const registration = required(contexts.get('current')).registerDevice({ userId: 'repeated-logout-user' })

      void registration.catch(() => undefined)
      operations.push(registration)
    })
    await settle()
    assert.equal(native.sync.mock.calls[0][0].deviceId, ACKNOWLEDGED_DEVICE_ID)
    await act(async () => {
      const logout = required(contexts.get('current')).logout()

      void logout.catch(() => undefined)
      operations.push(logout)
    })
    await act(async () => { root.update(tree('current', { oneSignalMigration: { ...migration, readinessTimeoutMs: 2000 } })) })
  } finally {
    await act(async () => { release({ action: 'created', deviceId: canonicalDeviceId }); await Promise.allSettled(operations) })
    await settle()
  }
  const scope = `${config.apiBaseUrl}/${config.appId}`

  assert.equal(native.stored.pendingLogouts?.[scope], canonicalDeviceId)
  assert.equal(native.stored.deviceId, ACKNOWLEDGED_DEVICE_ID, 'the stale result must not acknowledge a new binding')
  const marksBeforeRepeatedLogout = native.mark.mock.calls.length
  const disablesBeforeRepeatedLogout = native.update.mock.calls.length

  await act(async () => { await assert.rejects(required(contexts.get('current')).logout(), disableError) })
  await settle()
  assert.equal(native.mark.mock.calls[marksBeforeRepeatedLogout][1], ACKNOWLEDGED_DEVICE_ID, 'bootstrap must reproduce the stale in-memory target passed by the provider')
  assert.deepEqual(native.update.mock.calls.slice(disablesBeforeRepeatedLogout).map(([deviceId]) => deviceId), [canonicalDeviceId])
  assert.equal(native.stored.pendingLogouts?.[scope], canonicalDeviceId)
  assert.equal(required(contexts.get('current')).notificationsEnabled, false)
  native.update.mockResolvedValue(undefined)
  await act(async () => { await required(contexts.get('current')).logout() })
  await settle()
  assert.equal(native.update.mock.calls[native.update.mock.calls.length - 1][0], canonicalDeviceId)
  assert.deepEqual(native.stored.pendingLogouts, {})
  assertListeners(1)
})

for (const existingIdentity of [false, true]) {
  test(`a later compatible root logout disables the canonical result completed between roots, existing identity=${existingIdentity}`, async () => {
    const canonicalDeviceId = 'between-roots-canonical-device'

    if (existingIdentity) acknowledgeStoredDevice()
    const oldRoot = await mount('old')
    let releaseResponse!: (value: { action: string; deviceId: string }) => void
    const response = new Promise<{ action: string; deviceId: string }>((resolve) => { releaseResponse = resolve })
    let registration: Promise<void> | undefined

    native.sync.mockImplementationOnce(() => response)
    native.update.mockImplementation(async (deviceId) => {
      if (deviceId === ACKNOWLEDGED_DEVICE_ID) throw Object.assign(new Error('Obsolete device'), { status: 404 })
    })
    try {
      await act(async () => {
        registration = required(contexts.get('old')).registerDevice({ userId: 'between-roots-user' })
        void registration.catch(() => undefined)
      })
      await settle()
      assert.equal(native.sync.mock.calls.length, 1)
      await unmount(oldRoot)
      assertListeners(0)
    } finally {
      await act(async () => {
        releaseResponse({ action: 'created', deviceId: canonicalDeviceId })
        await Promise.allSettled([registration])
      })
      await settle()
    }
    assert.equal(native.update.mock.calls.length, 0, 'the outgoing response completes before any logout intent exists')
    assert.equal(native.stored.deviceId, existingIdentity ? ACKNOWLEDGED_DEVICE_ID : null)
    const operations: Promise<void>[] = []
    const onOperation = (operation: Promise<void>) => { operations.push(operation) }
    let replacement!: ReactTestRenderer

    await act(async () => {
      replacement = create(<BubblesNotificationsProvider {...config}>
        <LogoutFromLayout onOperation={onOperation} />

        <Consumer name='replacement' />
      </BubblesNotificationsProvider>)
    })
    roots.push(replacement)
    await act(async () => { await Promise.all(operations) })
    await settle()
    assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [canonicalDeviceId])
    assert.deepEqual(native.stored.pendingLogouts, {})
    assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
    assertListeners(1)
  })
}

test('successful replacement enrollment supersedes a logout-only stale canonical receipt', async () => {
  const staleDeviceId = 'superseded-receipt-device'
  const unrelatedScope = 'https://unrelated-receipt.example/other-app'
  const unrelatedDeviceId = 'unrelated-receipt-device'
  const oldRoot = await mount('old')
  let releaseResponse!: (value: { action: string; deviceId: string }) => void
  const response = new Promise<{ action: string; deviceId: string }>((resolve) => { releaseResponse = resolve })
  let registration: Promise<void> | undefined

  native.sync.mockImplementationOnce(() => response)
  try {
    await act(async () => {
      registration = required(contexts.get('old')).registerDevice({ userId: 'outgoing-receipt-user' })
      void registration.catch(() => undefined)
    })
    await settle()
    await unmount(oldRoot)
  } finally {
    await act(async () => { releaseResponse({ action: 'created', deviceId: staleDeviceId }); await Promise.allSettled([registration]) })
    await settle()
  }
  const scope = `${config.apiBaseUrl}/${config.appId}`

  assert.equal(native.stored.registrationLogoutTargets?.[scope], staleDeviceId)
  assert.equal(native.stored.deviceId, null)
  assert.equal(native.stored.pendingLogouts, undefined)
  native.stored.registrationLogoutTargets = { ...native.stored.registrationLogoutTargets, [unrelatedScope]: unrelatedDeviceId }
  await mount('replacement')
  await act(async () => { await required(contexts.get('replacement')).registerDevice({ userId: 'replacement-receipt-user' }) })
  assert.equal(native.sync.mock.calls[1][0].deviceId, null, 'a logout-only receipt must never become enrollment identity')
  assert.equal(native.stored.registrationLogoutTargets?.[scope], undefined)
  assert.equal(native.stored.registrationLogoutTargets?.[unrelatedScope], unrelatedDeviceId)
  await act(async () => { await required(contexts.get('replacement')).logout() })
  await settle()
  assert.deepEqual(native.update.mock.calls.map(([deviceId]) => deviceId), [CURRENT_DEVICE_ID])
  assert.equal(native.stored.registrationLogoutTargets?.[unrelatedScope], unrelatedDeviceId)
  assert.deepEqual(native.stored.pendingLogouts, {})
  assert.equal(required(contexts.get('replacement')).notificationsEnabled, false)
  assertListeners(1)
})

test('Suspense hide and reveal restores notification and AppState observers across repeated cycles', async () => {
  const callback = vi.fn()
  const presentation = { shouldPlaySound: true }
  const enrollments: Promise<void>[] = []
  let pending: Promise<void> | null = null
  let resolvePending: (() => void) | undefined

  function PassiveEnrollment () {
    const context = required(useContext(BubblesNotificationsContext))
    const initialRegister = useRef(context.registerDevice)

    useEffect(() => {
      const operation = initialRegister.current({ userId: 'suspense-user' })

      void operation.catch(() => undefined)
      enrollments.push(operation)
    }, [])

    return null
  }
  function ControlledSuspender () {
    if (pending) throw pending

    return 'visible'
  }
  function view () {
    return <Suspense fallback='loading'>
      <BubblesNotificationsProvider
        {...config}
        foregroundPresentation={presentation}
        onNotificationResponse={callback}
      >
        <Consumer name='current' />

        <PassiveEnrollment />

        <ControlledSuspender />
      </BubblesNotificationsProvider>
    </Suspense>
  }
  let root!: ReactTestRenderer

  await act(async () => { root = create(view()) })
  roots.push(root)
  await act(async () => { await Promise.all(enrollments) })
  await settle()
  assert.equal(enrollments.length, 1)
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  assert.equal(root.toJSON(), 'visible')
  assertListeners(1)
  for (let cycle = 0; cycle < 2; cycle++) {
    pending = new Promise<void>((resolve) => { resolvePending = resolve })
    await act(async () => { root.update(view()) })
    await settle()
    assert.equal(root.toJSON(), 'loading', 'the boundary outside the provider must hide its committed content')
    assertListeners(0)
    // The OS changes state while the hidden runtime has no AppState observer.
    native.currentState = 'background'
    pending = null
    await act(async () => { required(resolvePending)() })
    await settle()
    assert.equal(root.toJSON(), 'visible')
    assertListeners(1)
    const tokenReadsBeforeMissedResume = native.token.mock.calls.length

    native.currentState = 'active'
    emit(native.appStates, 'active')
    await settle()
    assert.ok(native.token.mock.calls.length > tokenReadsBeforeMissedResume, 'reveal must resample AppState after missing the background transition')
    assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
    emit(native.messages, { notification: { title: `Revealed notification ${cycle}`, body: 'Body' }, data: {} })
    const response = open()

    emit(native.responses, response)
    emit(native.responses, response)
    await settle()
    assert.equal(native.schedule.mock.calls.length, cycle + 1)
    assert.equal(callback.mock.calls.length, cycle + 1)
    assert.equal(enrollments.length, 1, 'revealing must preserve a session enrolled by a passive effect that does not replay')
    assert.equal(required(contexts.get('current')).notificationsEnabled, true)
    const tokenReadsBeforeRefresh = native.token.mock.calls.length

    emit(native.tokens, 'revealed-refresh-token')
    await settle()
    assert.ok(native.token.mock.calls.length > tokenReadsBeforeRefresh)
    const tokenReadsBeforeForeground = native.token.mock.calls.length

    emit(native.appStates, 'background')
    emit(native.appStates, 'active')
    await settle()
    assert.ok(native.token.mock.calls.length > tokenReadsBeforeForeground)
    assert.equal(native.sync.mock.calls.length, 1, 'a same-owner reveal must maintain the existing enrollment without duplicate backend enrollment')
    assertListeners(1)
  }
  await unmount(root)
  assertListeners(0)
  await mount('after-suspense')
  assertListeners(1)
})

test('startup notification response is delivered after descendant passive initialization', async () => {
  const phases: string[] = []

  function PassiveInitialization () {
    useEffect(() => { phases.push('child passive initialization') }, [])

    return null
  }
  native.lastResponse = open()
  let root!: ReactTestRenderer

  await act(async () => {
    root = create(<BubblesNotificationsProvider
      {...config}
      onNotificationResponse={() => { phases.push('notification response') }}
    >
      <PassiveInitialization />
    </BubblesNotificationsProvider>)
  })
  roots.push(root)
  await settle()
  assert.deepEqual(phases, ['child passive initialization', 'notification response'])
  assert.equal(native.lastResponse, null)
  assertListeners(1)
})

test('same-owner Suspense reveal retries pending passive enrollment after its stale request drains', async () => {
  const enrollmentOptions = { userId: 'pending-suspense-user', appVersion: 'pending-version', aliasing: ['pending-alias'] }
  const enrollments: Promise<void>[] = []
  let suspended: Promise<void> | null = null
  let reveal!: () => void
  let releaseRegistration!: (value: { action: string; deviceId: string }) => void
  const response = new Promise<{ action: string; deviceId: string }>((resolve) => { releaseRegistration = resolve })

  native.sync.mockImplementationOnce(() => response)
  function PassivePendingEnrollment () {
    const context = required(useContext(BubblesNotificationsContext))
    const initialRegister = useRef(context.registerDevice)

    useEffect(() => {
      const operation = initialRegister.current(enrollmentOptions)

      void operation.catch(() => undefined)
      enrollments.push(operation)
    }, [])

    return null
  }
  function ControlledSuspender () {
    if (suspended) throw suspended

    return 'visible pending enrollment'
  }
  function view () {
    return <Suspense fallback='loading pending enrollment'>
      <BubblesNotificationsProvider {...config}>
        <PassivePendingEnrollment />

        <Consumer name='current' />

        <ControlledSuspender />
      </BubblesNotificationsProvider>
    </Suspense>
  }
  let root!: ReactTestRenderer

  await act(async () => { root = create(view()) })
  roots.push(root)
  try {
    await settle()
    assert.equal(native.sync.mock.calls.length, 1)
    suspended = new Promise<void>((resolve) => { reveal = resolve })
    await act(async () => { root.update(view()) })
    await settle()
    assert.equal(root.toJSON(), 'loading pending enrollment')
    assertListeners(0)
    suspended = null
    await act(async () => { reveal() })
    await settle()
    assert.equal(root.toJSON(), 'visible pending enrollment')
  } finally {
    await act(async () => {
      releaseRegistration({ action: 'created', deviceId: 'stale-suspense-device' })
      await Promise.allSettled(enrollments)
    })
    await settle()
  }
  assert.equal(enrollments.length, 1, 'the passive consumer must not replay enrollment')
  assert.deepEqual(native.sync.mock.calls.map(([options]) => ({ userId: options.userId, appVersion: options.appVersion, aliasing: options.aliasing })), [
    enrollmentOptions,
    enrollmentOptions
  ])
  assert.equal(native.stored.deviceId, CURRENT_DEVICE_ID)
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  assertListeners(1)
})

test('revealing an older hidden provider cannot take ownership back from a newer compatible root', async () => {
  const oldCallback = vi.fn()
  const currentCallback = vi.fn()
  let suspended: Promise<void> | null = null
  let reveal!: () => void

  function ControlledSuspender () {
    if (suspended) throw suspended

    return 'old visible provider'
  }
  function oldView () {
    return <Suspense fallback='old hidden provider'>
      <BubblesNotificationsProvider
        {...config}
        onNotificationResponse={oldCallback}
      >
        <ControlledSuspender />
      </BubblesNotificationsProvider>
    </Suspense>
  }
  let oldRoot!: ReactTestRenderer

  await act(async () => { oldRoot = create(oldView()) })
  roots.push(oldRoot)
  await settle()
  suspended = new Promise<void>((resolve) => { reveal = resolve })
  await act(async () => { oldRoot.update(oldView()) })
  await settle()
  assert.equal(oldRoot.toJSON(), 'old hidden provider')
  assertListeners(0)
  await mount('current', { onNotificationResponse: currentCallback, foregroundPresentation: { shouldPlaySound: true } })
  suspended = null
  await act(async () => { reveal() })
  await settle()
  assert.equal(oldRoot.toJSON(), 'old visible provider')
  assertListeners(1)
  const response = open()

  emit(native.responses, response)
  emit(native.responses, response)
  assert.equal(oldCallback.mock.calls.length, 0)
  assert.equal(currentCallback.mock.calls.length, 1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
  await unmount(oldRoot)
  assertListeners(1)
  emit(native.responses, open())
  assert.equal(currentCallback.mock.calls.length, 2)
})

test('revealing a provider updated while hidden reconnects the latest configuration and callbacks', async () => {
  const oldCallback = vi.fn()
  const currentCallback = vi.fn()
  const oldPresentation = { shouldPlaySound: false }
  const currentPresentation = { shouldPlaySound: true }
  const updatedAppKey = 'hidden-update-app-key'
  let pending: Promise<void> | null = null
  let reveal!: () => void

  function ControlledSuspender () {
    if (pending) throw pending

    return 'updated provider visible'
  }
  function view (updated: boolean) {
    return <Suspense fallback='updated provider hidden'>
      <BubblesNotificationsProvider
        {...config}
        appKey={updated ? updatedAppKey : config.appKey}
        foregroundPresentation={updated ? currentPresentation : oldPresentation}
        onNotificationResponse={updated ? currentCallback : oldCallback}
      >
        <Consumer name='current' />

        <ControlledSuspender />
      </BubblesNotificationsProvider>
    </Suspense>
  }
  let root!: ReactTestRenderer

  await act(async () => { root = create(view(false)) })
  roots.push(root)
  await settle()
  assertListeners(1)
  const staleResponseListener = [...native.responses][0]

  pending = new Promise<void>((resolve) => { reveal = resolve })
  await act(async () => { root.update(view(false)) })
  await settle()
  assert.equal(root.toJSON(), 'updated provider hidden')
  assertListeners(0)
  await act(async () => { root.update(view(true)) })
  await settle()
  assert.equal(root.toJSON(), 'updated provider hidden')
  assertListeners(0)
  pending = null
  await act(async () => { reveal() })
  await settle()
  assert.equal(root.toJSON(), 'updated provider visible')
  assertListeners(1)
  assert.equal((await required(native.handler).handleNotification()).shouldPlaySound, true)
  const response = open()

  staleResponseListener(response as never)
  emit(native.responses, response)
  emit(native.responses, response)
  emit(native.messages, { notification: { title: 'Updated hidden provider notification', body: 'Body' }, data: {} })
  await settle()
  assert.equal(oldCallback.mock.calls.length, 0)
  assert.equal(currentCallback.mock.calls.length, 1)
  assert.equal(native.schedule.mock.calls.length, 1)
  await act(async () => { await required(contexts.get('current')).registerDevice({ userId: 'hidden-update-user' }) })
  assert.equal(native.sync.mock.calls.length, 1)
  assert.equal(native.sync.mock.calls[0][0].appKey, updatedAppKey)
  assert.equal(required(contexts.get('current')).notificationsEnabled, true)
  await unmount(root)
  assertListeners(0)
})
