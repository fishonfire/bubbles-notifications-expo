import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { StrictMode, useContext } from 'react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import type { BubblesNotificationsContextValue, BubblesNotificationsProviderProps } from '../../src/runtime/context'
import type { StoredDeviceState } from '../../src/storage/device-state'

type Listener = (value: never) => void
const native = vi.hoisted(() => ({
  messages: new Set<Listener>(), responses: new Set<Listener>(), tokens: new Set<Listener>(), appStates: new Set<Listener>(),
  schedule: vi.fn(async () => 'local-id'),
  handler: null as null | { handleNotification: () => Promise<Record<string, boolean>> },
  sync: vi.fn(async (_options: Record<string, unknown>) => ({ action: 'created', deviceId: 'initial-device' })),
  update: vi.fn(async () => undefined),
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
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: Listener) => ({ remove: subscribe(native.appStates, listener) }) }
}))
vi.doMock('expo-constants', () => ({ default: { expoConfig: { extra: { bubblesNotificationsExpo: { defaultChannelId: 'default', defaultChannelName: 'Default', androidChannelImportance: 'default' } } } } }))
vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({}), getToken: async () => 'token-current',
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
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => undefined,
  addNotificationResponseReceivedListener: (listener: Listener) => ({ remove: subscribe(native.responses, listener) })
}))
vi.doMock('../../src/storage/installation-id', () => ({ getOrCreateInstallationId: async () => 'installation' }))
vi.doMock('../../src/storage/device-state', () => ({
  getRegistrationScope: (url: string, appId: string | number) => `${url}/${appId}`,
  prepareRegistrationScope: async (url: string, appId: string | number, appKey: string, isCurrent?: () => boolean) => {
    if (isCurrent && !isCurrent()) throw new Error('Stale scope')
    native.stored = { ...native.stored, apiBaseUrl: url, appKey, registrationScope: `${url}/${appId}` }

    return { ...native.stored }
  },
  readStoredDeviceStateAsync: async () => ({ ...native.stored }),
  readStoredDeviceIdAsync: async () => native.stored.deviceId,
  patchStoredDeviceStateAsync: async (patch: StoredDeviceState) => (native.stored = { ...native.stored, ...patch }),
  acknowledgeRegistrationScope: async (_scope: string, deviceId: string, installationId: string, _subscription: unknown, _appId: unknown, isCurrent?: () => boolean) => {
    if (isCurrent && !isCurrent()) throw new Error('Stale acknowledgement')
    native.stored = { ...native.stored, deviceId, identityAcknowledged: true, acknowledgedInstallationId: installationId }

    return { ...native.stored }
  },
  markPendingLogout: async (scope: string, deviceId: string | null) => { native.stored.pendingLogouts = { ...native.stored.pendingLogouts, [scope]: deviceId } },
  clearPendingLogout: async (scope: string) => { delete native.stored.pendingLogouts?.[scope] }
}))
vi.doMock('../../src/api/device-client', () => ({
  syncBubblesDevice: native.sync,
  updateBubblesDeviceAttributes: async () => undefined,
  createBubblesDeviceClient: () => ({ updateDevice: native.update })
}))
vi.doMock('../../src/runtime/device-attributes', () => ({ collectBubblesDeviceAttributes: async () => ({}) }))
vi.doMock('../../src/notifications/delivery-status', () => ({
  flushStoredBubblesDeliveryStatuses: async () => undefined,
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
  native.sync.mockReset().mockImplementation(async () => ({ action: 'created', deviceId: 'device-current' }))
  native.schedule.mockClear()
  native.update.mockClear()
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
  assert.equal(native.stored.deviceId, 'device-current')
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
