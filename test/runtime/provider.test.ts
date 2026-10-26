import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'

import type {
  BubblesNotificationsLogoutEvent,
  BubblesNotificationsProviderProps
} from '../../src/runtime/context.ts'

const EXPLICIT_USER_ID = 'explicit-user'
const PRIMARY_API_BASE_URL = 'https://api.one.example'

const STORED_DEVICE = 'stored-device'
const PUSH_TOKEN = 'push-token'
const REGISTERED_DEVICE = 'registered-device'
const STORED_PUSH_TOKEN = 'stored-push-token'
const APP_KEY = 'app-key-123'
const API_BASE_URL = 'https://api.example.com'
const ROTATED_TOKEN = 'rotated-token'
const LEGACY_USER = 'legacy-user'
const LEGACY_ALIAS = 'legacy-alias'
const PADDED_EXPLICIT_USER_ID = ` ${EXPLICIT_USER_ID} `
const EXPLICIT_ALIAS = 'explicit-alias'
const FIRST_ROTATED_TOKEN = 'first-rotated-token'
const SECOND_ROTATED_TOKEN = 'second-rotated-token'
const CURRENT_USER = 'current-user'
const REPLACEMENT_APP_KEY = 'replacement-app-key'
const PADDED_PRIMARY_API_BASE_URL = ` ${PRIMARY_API_BASE_URL} `
const OTHER_USER = 'other-user'

type Cleanup = (() => void) | void;

interface ProviderContextValue {
  logout: () => Promise<void>;
  registerDevice: (
    options?: Record<string, unknown>,
  ) => Promise<void>;
  setDeviceAttributes: (
    attributes: Record<string, unknown>,
  ) => Promise<void>;
  addDeviceAttribute: (name: string, value: unknown) => Promise<void>;
  notificationsEnabled: boolean;
  isSyncing: boolean;
  error: Error | null;
}

interface SyncResult {
  action: 'created' | 'updated';
  deviceId: string | null;
  pushToken: string | null;
  tokenType: string | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
  registrationState: RegistrationState;
}

interface RegistrationState {
  platform: 'ios' | 'android';
  tokenType: 'fcm' | 'fid' | null;
  token: string | null;
  fid: string | null;
  permissionStatus: string;
  notificationsEnabled: boolean;
}

function areHookDependenciesEqual (
  previous: unknown[] | undefined,
  next: unknown[] | undefined
): boolean {
  if (previous === undefined || next === undefined) {
    return false
  }

  if (previous.length !== next.length) {
    return false
  }

  return next.every((value, index) => Object.is(value, previous[index]))
}

async function flushMicrotasks () {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

function createDeferred<Value> () {
  let resolvePromise!: (value: Value) => void
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise
  }
}

class HookRenderer<Props> {
  private hookIndex = 0

  private needsRender = false

  private readonly stateSlots: unknown[] = []

  private readonly refSlots: { current: unknown }[] = []

  private readonly memoSlots: {
    deps: unknown[] | undefined;
    value: unknown;
  }[] = []

  private readonly effectSlots: {
    deps: unknown[] | undefined;
    effect: () => Cleanup;
    cleanup?: () => void;
  }[] = []

  private pendingEffectIndexes: number[] = []

  output:
    | {
        props: {
          value: ProviderContextValue;
        };
      }
    | null = null

  private readonly component: (props: Props) => unknown

  private props: Props

  constructor (component: (props: Props) => unknown, props: Props) {
    this.component = component
    this.props = props
  }

  useState<State> (
    initialState: State | (() => State)
  ): [State, (update: State | ((state: State) => State)) => void] {
    const slotIndex = this.hookIndex

    if (!(slotIndex in this.stateSlots)) {
      this.stateSlots[slotIndex] =
        typeof initialState === 'function'
          ? (initialState as () => State)()
          : initialState
    }

    const setState = (
      update: State | ((state: State) => State)
    ) => {
      const currentState = this.stateSlots[slotIndex] as State

      this.stateSlots[slotIndex] =
        typeof update === 'function'
          ? (update as (state: State) => State)(currentState)
          : update
      this.needsRender = true
    }

    this.hookIndex += 1

    return [this.stateSlots[slotIndex] as State, setState]
  }

  useRef<Value> (initialValue: Value): { current: Value } {
    const slotIndex = this.hookIndex

    if (!(slotIndex in this.refSlots)) {
      this.refSlots[slotIndex] = {
        current: initialValue
      }
    }

    this.hookIndex += 1

    return this.refSlots[slotIndex] as { current: Value }
  }

  useMemo<Value> (factory: () => Value, deps?: unknown[]): Value {
    const slotIndex = this.hookIndex
    const previousMemo = this.memoSlots[slotIndex]

    if (
      previousMemo === undefined ||
      !areHookDependenciesEqual(previousMemo.deps, deps)
    ) {
      this.memoSlots[slotIndex] = {
        deps,
        value: factory()
      }
    }

    this.hookIndex += 1

    return this.memoSlots[slotIndex].value as Value
  }

  useCallback<Callback> (
    callback: Callback,
    deps?: unknown[]
  ): Callback {
    return this.useMemo(() => callback, deps)
  }

  useEffect (
    effect: () => Cleanup,
    deps?: unknown[]
  ): void {
    const slotIndex = this.hookIndex
    const previousEffect = this.effectSlots[slotIndex]
    const shouldRun =
      previousEffect === undefined ||
      !areHookDependenciesEqual(previousEffect.deps, deps)

    this.effectSlots[slotIndex] = {
      deps,
      effect,
      cleanup: previousEffect?.cleanup
    }

    if (shouldRun) {
      this.pendingEffectIndexes.push(slotIndex)
    }

    this.hookIndex += 1
  }

  async flush () {
    let safetyCounter = 0

    do {
      if (this.output === null || this.needsRender) {
        this.needsRender = false
        this.render()
        this.runEffects()
      }

      await flushMicrotasks()
      safetyCounter += 1
    } while (
      (this.needsRender || this.pendingEffectIndexes.length > 0) &&
      safetyCounter < 20
    )

    if (this.needsRender || this.pendingEffectIndexes.length > 0) {
      throw new Error('HookRenderer did not reach a stable state.')
    }
  }

  async mountWithStrictModeEffectReplay () {
    this.render()
    this.runEffects()

    for (const effect of this.effectSlots) {
      effect?.cleanup?.()
    }

    for (const effect of this.effectSlots) {
      if (!effect) {
        continue
      }

      const cleanup = effect.effect()

      effect.cleanup =
        typeof cleanup === 'function' ? cleanup : undefined
    }

    await this.flush()
  }

  async update (props: Props) {
    this.props = props
    this.needsRender = true
    await this.flush()
  }

  abandonRender (props: Props) {
    const committedProps = this.props
    const committedOutput = this.output
    const committedEffects = [...this.effectSlots]
    const committedMemos = [...this.memoSlots]
    const committedPendingEffects = [...this.pendingEffectIndexes]

    this.props = props
    this.render()
    this.props = committedProps
    this.output = committedOutput
    this.effectSlots.splice(0, this.effectSlots.length, ...committedEffects)
    this.memoSlots.splice(0, this.memoSlots.length, ...committedMemos)
    this.pendingEffectIndexes = committedPendingEffects
  }

  unmount () {
    for (const effect of this.effectSlots) {
      effect?.cleanup?.()
    }
  }

  private render () {
    this.hookIndex = 0
    rendererState.current = this

    try {
      this.output = this.component(this.props) as HookRenderer<Props>['output']
    } finally {
      rendererState.current = null
    }
  }

  private runEffects () {
    const effectIndexes = [...this.pendingEffectIndexes]

    this.pendingEffectIndexes = []

    for (const effectIndex of effectIndexes) {
      const effect = this.effectSlots[effectIndex]

      effect?.cleanup?.()

      const cleanup = effect?.effect()

      effect.cleanup =
        typeof cleanup === 'function' ? cleanup : undefined
    }
  }
}

const rendererState: {
  current: Pick<HookRenderer<never>, 'useState' | 'useRef' | 'useMemo' | 'useCallback' | 'useEffect'> | null;
} = { current: null }

const storedState = {
  deviceId: STORED_DEVICE as string | null
}
const apiBaseUrlCalls: string[] = []
const appKeyCalls: string[] = []
let ensureChannelCallCount = 0
const registerCalls: Record<string, unknown>[] = []
const syncCalls: Record<string, unknown>[] = []
const maintenanceCalls: Record<string, unknown>[] = []
const attributeCalls: Record<string, unknown>[] = []
const notificationHandlerCalls: (Record<string, unknown> | undefined)[] = []
let notificationHandlerAcquireCallCount = 0
let notificationHandlerReleaseCallCount = 0
let activeNotificationHandlerOwner: object | null = null
const responseObserverCalls: Record<string, unknown>[] = []
let responseObserverCleanupCallCount = 0
const permissionCalls: (Record<string, unknown> | undefined)[] = []
let permissionState = {
  granted: false,
  status: 'denied'
}
let currentAppState = 'active'
const appStateListeners = new Set<(state: string) => void>()
const deliveryStatusFlushCalls: (Record<string, unknown> | undefined)[] = []
let deliveryStatusFlushError: Error | null = null
let tokenRefreshListener: ((token: string) => void) | null = null
let tokenRefreshCleanupCallCount = 0
const grantedRegistrationState: RegistrationState = {
  platform: 'ios',
  tokenType: 'fcm',
  token: PUSH_TOKEN,
  fid: 'fid-123',
  permissionStatus: 'granted',
  notificationsEnabled: true
}
const registerState: {
  implementation: (
    options: Record<string, unknown>,
  ) => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'created',
    deviceId: REGISTERED_DEVICE,
    pushToken: PUSH_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
}
const syncState: {
  implementation: (
    options: Record<string, unknown>,
  ) => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'updated',
    deviceId: STORED_DEVICE,
    pushToken: STORED_PUSH_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: {
      ...grantedRegistrationState,
      token: STORED_PUSH_TOKEN
    }
  })
}
const maintenanceState: {
  implementation: (
    options: Record<string, unknown>,
  ) => Promise<{
    registrationState: RegistrationState;
    syncResult: Omit<SyncResult, 'registrationState'> | null;
  }>;
} = {
  implementation: async () => ({
    registrationState: grantedRegistrationState,
    syncResult: null
  })
}

class MockBubblesNotificationsSyncError extends Error {
  readonly snapshot: Record<string, unknown>

  readonly cause: unknown

  constructor (
    message: string,
    snapshot: Record<string, unknown>,
    cause?: unknown
  ) {
    super(message)
    this.name = 'BubblesNotificationsSyncError'
    this.snapshot = snapshot
    this.cause = cause
  }
}

const markLogout = vi.fn(async (_configuration: unknown, _deviceId: string | null) => undefined)
const retryLogout = vi.fn(async (_configuration: unknown) => undefined)

vi.doMock('../../src/runtime/logout.ts', () => ({
  markBubblesLogout: markLogout,
  retryBubblesLogout: retryLogout
}))

vi.doMock('react', () => ({
  createContext (defaultValue: unknown) {
    return {
      Provider: Symbol('ContextProvider'),
      defaultValue
    }
  },
  useEffect (
    effect: () => Cleanup,
    deps?: unknown[]
  ) {
    if (!rendererState.current) {
      throw new Error('useEffect called without an active renderer.')
    }

    rendererState.current.useEffect(effect, deps)
  },
  useLayoutEffect (effect: () => Cleanup, deps?: unknown[]) {
    if (!rendererState.current) {
      throw new Error('useLayoutEffect called without an active renderer.')
    }
    rendererState.current.useEffect(effect, deps)
  },
  useCallback<Callback> (
    callback: Callback,
    deps?: unknown[]
  ) {
    if (!rendererState.current) {
      throw new Error('useCallback called without an active renderer.')
    }

    return rendererState.current.useCallback(callback, deps)
  },
  useMemo<Value> (factory: () => Value, deps?: unknown[]) {
    if (!rendererState.current) {
      throw new Error('useMemo called without an active renderer.')
    }

    return rendererState.current.useMemo(factory, deps)
  },
  useRef<Value> (initialValue: Value) {
    if (!rendererState.current) {
      throw new Error('useRef called without an active renderer.')
    }

    return rendererState.current.useRef(initialValue)
  },
  useState<State> (initialState: State | (() => State)) {
    if (!rendererState.current) {
      throw new Error('useState called without an active renderer.')
    }

    return rendererState.current.useState(initialState)
  }
}))

const jsxRuntime = {
  Fragment: Symbol.for('Fragment'),
  jsx: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props
  }),
  jsxDEV: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props
  }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props
  })
}

vi.doMock('react/jsx-runtime', () => jsxRuntime)
vi.doMock('react/jsx-dev-runtime', () => jsxRuntime)

vi.doMock('../../src/storage/installation-id.ts', () => ({ getOrCreateInstallationId: async () => 'uuid' }))
vi.doMock('../../src/runtime/migration.ts', () => ({ normalizeSubscriptionId: (id: string | null) => id?.trim() || null }))

vi.doMock('react-native', () => ({
  AppState: {
    get currentState () {
      return currentAppState
    },
    addEventListener: (
      event: string,
      listener: (state: string) => void
    ) => {
      assert.equal(event, 'change')
      appStateListeners.add(listener)

      return {
        remove: () => {
          appStateListeners.delete(listener)
        }
      }
    }
  }
}))

vi.doMock('../../src/storage/device-state.ts', () => ({
  readStoredDeviceIdAsync: async () => storedState.deviceId,
  prepareRegistrationScope: async (apiBaseUrl: string, _appId: string, appKey: string) => {
    apiBaseUrlCalls.push(apiBaseUrl); appKeyCalls.push(appKey)

    return { deviceId: storedState.deviceId, apiBaseUrl, appKey, identityAcknowledged: true, acknowledgedInstallationId: 'uuid' }
  },
  patchStoredDeviceStateAsync: async (
    value: {
      apiBaseUrl?: string | null;
      appKey?: string | null;
    }
  ) => {
    if ('apiBaseUrl' in value) {
      apiBaseUrlCalls.push(value.apiBaseUrl as string)
    }

    if ('appKey' in value) {
      appKeyCalls.push(value.appKey as string)
    }

    return {
      deviceId: storedState.deviceId,
      apiBaseUrl: apiBaseUrlCalls[apiBaseUrlCalls.length - 1] ?? null,
      appKey: appKeyCalls[appKeyCalls.length - 1] ?? null
    }
  }
}))

vi.doMock('../../src/runtime/register-device.ts', () => ({
  maintainBubblesDevice: async (options: Record<string, unknown>) => {
    const recorded = { ...options }

    delete recorded.isCurrent; delete recorded.oneSignalMigration
    maintenanceCalls.push(recorded)

    return maintenanceState.implementation(options)
  },
  registerBubblesDevice: async (options: Record<string, unknown>) => {
    const recordedOptions = { ...options }

    delete recordedOptions.loadDeviceId
    delete recordedOptions.isCurrent
    delete recordedOptions.oneSignalMigration
    registerCalls.push(recordedOptions)

    return registerState.implementation(options)
  },
  syncExistingBubblesDevice: async (options: Record<string, unknown>) => {
    syncCalls.push(options)

    return syncState.implementation(options)
  }
}))

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  flushStoredBubblesDeliveryStatuses: async (
    storedDeviceState?: Record<string, unknown>
  ) => {
    deliveryStatusFlushCalls.push(storedDeviceState)

    if (deliveryStatusFlushError) {
      throw deliveryStatusFlushError
    }
  }
}))

vi.doMock('../../src/api/device-client.ts', () => ({
  updateBubblesDeviceAttributes: async (options: Record<string, unknown>) => {
    attributeCalls.push(options)
  }
}))

vi.doMock('../../src/runtime/presentation.ts', () => ({
  getNotificationPermissions: async (
    options?: Record<string, unknown>
  ) => {
    permissionCalls.push(options)
    ensureChannelCallCount += 1

    return permissionState
  },
  describeNotificationPermissionStatus: (
    permissions: typeof permissionState
  ) => permissions.status,
  isNotificationPermissionGranted: (
    permissions: typeof permissionState
  ) => permissions.granted,
  acquireBubblesForegroundPresentation: (owner: object) => {
    if (
      activeNotificationHandlerOwner !== null &&
      activeNotificationHandlerOwner !== owner
    ) {
      throw new Error(
        '[@fishonfire/bubbles-expo] Only one BubblesNotificationsProvider may be mounted at a time.'
      )
    }

    activeNotificationHandlerOwner = owner
    notificationHandlerAcquireCallCount += 1

    return () => {
      if (activeNotificationHandlerOwner === owner) {
        activeNotificationHandlerOwner = null
        notificationHandlerReleaseCallCount += 1
      }
    }
  },
  updateBubblesForegroundPresentation: (
    owner: object,
    options?: Record<string, unknown>
  ) => {
    if (activeNotificationHandlerOwner === owner) {
      notificationHandlerCalls.push(options)
    }
  },
  observeBubblesNotificationOpenEvents: (
    options: Record<string, unknown>
  ) => {
    responseObserverCalls.push(options)

    return () => {
      responseObserverCleanupCallCount += 1
    }
  }
}))

vi.doMock('../../src/runtime/transport.ts', () => ({
  observeBubblesForegroundRemoteMessages: () => () => undefined,
  observeBubblesDeviceTokenRefresh: (
    listener: (token: string) => void
  ) => {
    tokenRefreshListener = listener

    return () => {
      tokenRefreshListener = null
      tokenRefreshCleanupCallCount += 1
    }
  }
}))

vi.doMock('../../src/runtime/sync-device.ts', () => ({
  BubblesNotificationsSyncError: MockBubblesNotificationsSyncError
}))

const { BubblesNotificationsProvider } = await import(
  '../../src/runtime/BubblesNotificationsProvider.tsx'
)

beforeEach(() => {
  markLogout.mockReset().mockResolvedValue(undefined)
  retryLogout.mockReset().mockResolvedValue(undefined)
  storedState.deviceId = STORED_DEVICE
  apiBaseUrlCalls.length = 0
  appKeyCalls.length = 0
  ensureChannelCallCount = 0
  registerCalls.length = 0
  syncCalls.length = 0
  maintenanceCalls.length = 0
  attributeCalls.length = 0
  notificationHandlerCalls.length = 0
  notificationHandlerAcquireCallCount = 0
  notificationHandlerReleaseCallCount = 0
  activeNotificationHandlerOwner = null
  responseObserverCalls.length = 0
  responseObserverCleanupCallCount = 0
  permissionCalls.length = 0
  permissionState = {
    granted: false,
    status: 'denied'
  }
  currentAppState = 'active'
  appStateListeners.clear()
  deliveryStatusFlushCalls.length = 0
  deliveryStatusFlushError = null
  tokenRefreshListener = null
  tokenRefreshCleanupCallCount = 0
  registerState.implementation = async () => ({
    action: 'created',
    deviceId: REGISTERED_DEVICE,
    pushToken: PUSH_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: STORED_DEVICE,
    pushToken: STORED_PUSH_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: {
      ...grantedRegistrationState,
      token: STORED_PUSH_TOKEN
    }
  })
  maintenanceState.implementation = async () => ({
    registrationState: grantedRegistrationState,
    syncResult: null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function createProviderProps (
  overrides: Partial<BubblesNotificationsProviderProps> = {}
): BubblesNotificationsProviderProps {
  return {
    appId: 'app-123',
    appKey: APP_KEY,
    apiBaseUrl: API_BASE_URL,
    children: 'child',
    ...overrides
  }
}

async function renderProvider (
  overrides: Partial<BubblesNotificationsProviderProps> = {}
) {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps(overrides)
  )

  await renderer.flush()

  return renderer
}

function getContextValue (
  renderer: HookRenderer<BubblesNotificationsProviderProps>
) {
  if (!renderer.output) {
    throw new Error('Provider output was not rendered.')
  }

  return renderer.output.props.value
}

async function emitAppState (nextAppState: string) {
  currentAppState = nextAppState

  for (const listener of appStateListeners) {
    listener(nextAppState)
  }

  await flushMicrotasks()
}

async function emitTokenRefresh (token = ROTATED_TOKEN) {
  tokenRefreshListener?.(token)
  await flushMicrotasks()
}

test('BubblesNotificationsProvider exposes only supported hook actions and state', async () => {
  const renderer = await renderProvider({
    ready: false
  })

  assert.deepEqual(Object.keys(getContextValue(renderer)).sort(), [
    'addDeviceAttribute',
    'error',
    'isSyncing',
    'logout',
    'notificationsEnabled',
    'registerDevice',
    'setDeviceAttributes'
  ])
  assert.deepEqual(syncCalls, [])

  renderer.unmount()
})

test('BubblesNotificationsProvider bootstraps without authentication or prompting for permission', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: null
  })

  assert.deepEqual(permissionCalls, [
    { requestPermissions: false }
  ])
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  assert.deepEqual(registerCalls, [])
  assert.deepEqual(syncCalls, [])
  assert.deepEqual(apiBaseUrlCalls, [API_BASE_URL])
  assert.equal(ensureChannelCallCount, 1)
  assert.equal(notificationHandlerCalls.length, 1)
  assert.equal(responseObserverCalls.length, 1)

  renderer.unmount()
})

test('BubblesNotificationsProvider flushes stored delivery statuses during startup with complete configuration', async () => {
  const renderer = await renderProvider({
    ready: false
  })

  assert.deepEqual(deliveryStatusFlushCalls, [
    {
      deviceId: STORED_DEVICE,
      apiBaseUrl: API_BASE_URL,
      appKey: APP_KEY,
      identityAcknowledged: true,
      acknowledgedInstallationId: 'uuid'
    }
  ])

  renderer.unmount()
})

test('BubblesNotificationsProvider flushes stored delivery statuses when the app returns to the foreground', async () => {
  const renderer = await renderProvider({
    ready: false
  })

  deliveryStatusFlushCalls.length = 0
  await emitAppState('background')
  await emitAppState('active')

  assert.deepEqual(deliveryStatusFlushCalls, [])

  renderer.unmount()
  assert.equal(appStateListeners.size, 0)
})

test('BubblesNotificationsProvider does not maintain a device before session enrollment', async () => {
  const renderer = await renderProvider()

  await emitTokenRefresh()
  await emitAppState('background')
  await emitAppState('active')
  await renderer.flush()

  assert.deepEqual(maintenanceCalls, [])

  renderer.unmount()
})

test('BubblesNotificationsProvider keeps startup successful when delivery-status flush fails', async () => {
  deliveryStatusFlushError = new Error('delivery status unavailable')
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const renderer = await renderProvider({
    ready: false
  })

  assert.equal(getContextValue(renderer).error, null)
  assert.equal(ensureChannelCallCount, 1)
  assert.equal(consoleError.mock.calls.length, 1)

  consoleError.mockRestore()
  renderer.unmount()
})

test('BubblesNotificationsProvider starts bootstrap directly', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: false
    })
  )

  await renderer.flush()

  assert.equal(responseObserverCalls.length, 1)
  assert.deepEqual(apiBaseUrlCalls, [API_BASE_URL])
  assert.equal(ensureChannelCallCount, 1)
  renderer.unmount()
})

test('BubblesNotificationsProvider survives Strict Mode effect replay', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: false,
      userId: null
    })
  )

  await renderer.mountWithStrictModeEffectReplay()

  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  assert.equal(responseObserverCalls.length, 2)
  assert.equal(responseObserverCleanupCallCount, 1)
  assert.equal(appStateListeners.size, 1)
  assert.equal(notificationHandlerAcquireCallCount, 2)
  assert.equal(notificationHandlerReleaseCallCount, 1)

  renderer.unmount()
})

test('BubblesNotificationsProvider rejects a duplicate mounted provider', async () => {
  const firstRenderer = await renderProvider()
  const duplicateRenderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps()
  )

  await assert.rejects(
    () => duplicateRenderer.flush(),
    /Only one BubblesNotificationsProvider may be mounted at a time\./
  )

  assert.equal(notificationHandlerAcquireCallCount, 1)
  assert.equal(notificationHandlerReleaseCallCount, 0)
  assert.equal(responseObserverCalls.length, 1)

  firstRenderer.unmount()
  assert.equal(notificationHandlerReleaseCallCount, 1)
})

test('BubblesNotificationsProvider enrolls explicitly without provider authentication props', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: LEGACY_USER,
    aliasing: [LEGACY_ALIAS],
    appVersion: '0.9.0'
  })

  await getContextValue(renderer).registerDevice({
    userId: PADDED_EXPLICIT_USER_ID,
    aliasing: [EXPLICIT_ALIAS],
    appVersion: '1.0.0',
    requestPermissions: true,
    permissionRequestOptions: {
      ios: {
        allowAlert: true
      }
    }
  })
  await renderer.flush()

  assert.deepEqual(registerCalls, [
    {
      appId: 'app-123',
      appKey: APP_KEY,
      apiBaseUrl: API_BASE_URL,
      userId: EXPLICIT_USER_ID,
      aliasing: [EXPLICIT_ALIAS],
      appVersion: '1.0.0',
      deviceId: STORED_DEVICE,
      registrationOptions: {
        userId: PADDED_EXPLICIT_USER_ID,
        aliasing: [EXPLICIT_ALIAS],
        appVersion: '1.0.0',
        requestPermissions: true,
        permissionRequestOptions: {
          ios: {
            allowAlert: true
          }
        }
      }
    }
  ])
  assert.equal(getContextValue(renderer).error, null)

  renderer.unmount()
})

test('BubblesNotificationsProvider coalesces token refreshes into one post-enrollment maintenance update', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({
    userId: 'user-123',
    aliasing: ['primary'],
    appVersion: '1.0.0'
  })
  await renderer.flush()

  const rotatedRegistrationState: RegistrationState = {
    ...grantedRegistrationState,
    token: ROTATED_TOKEN
  }

  maintenanceState.implementation = async () => ({
    registrationState: rotatedRegistrationState,
    syncResult: {
      action: 'updated',
      deviceId: REGISTERED_DEVICE,
      pushToken: ROTATED_TOKEN,
      tokenType: 'fcm',
      permissionStatus: 'granted',
      notificationsEnabled: true
    }
  })

  tokenRefreshListener?.(ROTATED_TOKEN)
  tokenRefreshListener?.(ROTATED_TOKEN)
  await flushMicrotasks()
  await renderer.flush()

  assert.equal(maintenanceCalls.length, 1)
  assert.deepEqual(maintenanceCalls[0], {
    appId: 'app-123',
    appKey: APP_KEY,
    apiBaseUrl: API_BASE_URL,
    userId: 'user-123',
    aliasing: ['primary'],
    appVersion: '1.0.0',
    deviceId: REGISTERED_DEVICE,
    previousRegistrationState: grantedRegistrationState
  })
  renderer.unmount()
  assert.equal(tokenRefreshListener, null)
  assert.equal(tokenRefreshCleanupCallCount > 0, true)
})

test('BubblesNotificationsProvider performs one follow-up check for maintenance requested in flight', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: 'user-123' })
  await renderer.flush()

  const firstMaintenance = createDeferred<{
    registrationState: RegistrationState;
    syncResult: Omit<SyncResult, 'registrationState'> | null;
  }>()
  const firstRotatedState = {
    ...grantedRegistrationState,
    token: FIRST_ROTATED_TOKEN
  }
  const secondRotatedState = {
    ...grantedRegistrationState,
    token: SECOND_ROTATED_TOKEN
  }

  maintenanceState.implementation = async () => {
    if (maintenanceCalls.length === 1) {
      return firstMaintenance.promise
    }

    return {
      registrationState: secondRotatedState,
      syncResult: {
        action: 'updated',
        deviceId: REGISTERED_DEVICE,
        pushToken: SECOND_ROTATED_TOKEN,
        tokenType: 'fcm',
        permissionStatus: 'granted',
        notificationsEnabled: true
      }
    }
  }

  await emitTokenRefresh(FIRST_ROTATED_TOKEN)
  assert.equal(maintenanceCalls.length, 1)

  await emitTokenRefresh(SECOND_ROTATED_TOKEN)
  await emitTokenRefresh(SECOND_ROTATED_TOKEN)
  firstMaintenance.resolve({
    registrationState: firstRotatedState,
    syncResult: {
      action: 'updated',
      deviceId: REGISTERED_DEVICE,
      pushToken: FIRST_ROTATED_TOKEN,
      tokenType: 'fcm',
      permissionStatus: 'granted',
      notificationsEnabled: true
    }
  })
  await flushMicrotasks()
  await renderer.flush()

  assert.equal(maintenanceCalls.length, 2)
  assert.equal(
    maintenanceCalls[1]?.previousRegistrationState,
    firstRotatedState
  )
  renderer.unmount()
})

test('BubblesNotificationsProvider rechecks changed permissions after enrollment on foreground', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: 'user-123' })
  await renderer.flush()

  const deniedRegistrationState: RegistrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    fid: null,
    permissionStatus: 'denied',
    notificationsEnabled: false
  }

  maintenanceState.implementation = async () => ({
    registrationState: deniedRegistrationState,
    syncResult: {
      action: 'updated',
      deviceId: REGISTERED_DEVICE,
      pushToken: null,
      tokenType: null,
      permissionStatus: 'denied',
      notificationsEnabled: false
    }
  })

  await emitAppState('background')
  await emitAppState('active')
  await renderer.flush()

  assert.equal(maintenanceCalls.length, 1)
  assert.equal(getContextValue(renderer).notificationsEnabled, false)

  renderer.unmount()
})

test('BubblesNotificationsProvider maintains a compatibly enrolled device after token refresh', async () => {
  const renderer = await renderProvider({
    ready: true,
    userId: LEGACY_USER,
    aliasing: ['legacy']
  })

  await getContextValue(renderer).registerDevice()
  await renderer.flush()
  await emitTokenRefresh()
  await renderer.flush()

  assert.equal(maintenanceCalls.length, 1)
  assert.equal(maintenanceCalls[0]?.userId, LEGACY_USER)
  assert.deepEqual(maintenanceCalls[0]?.aliasing, ['legacy'])

  renderer.unmount()
})

test('BubblesNotificationsProvider registerDevice rejects an empty explicit userId', async () => {
  const renderer = await renderProvider()

  await assert.rejects(
    () => getContextValue(renderer).registerDevice({ userId: '   ' }),
    /"registerDevice\(options\)" requires a non-empty "userId"\./
  )
  await renderer.flush()

  assert.deepEqual(registerCalls, [])
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "registerDevice(options)" requires a non-empty "userId".'
  )

  renderer.unmount()
})

test('BubblesNotificationsProvider supports deprecated provider enrollment props', async () => {
  storedState.deviceId = null
  const renderer = await renderProvider({
    ready: true,
    userId: ' legacy-user ',
    aliasing: [LEGACY_ALIAS],
    appVersion: '0.9.0'
  })

  await getContextValue(renderer).registerDevice()
  await renderer.flush()

  assert.deepEqual(registerCalls, [
    {
      appId: 'app-123',
      appKey: APP_KEY,
      apiBaseUrl: API_BASE_URL,
      userId: LEGACY_USER,
      aliasing: [LEGACY_ALIAS],
      appVersion: '0.9.0',
      deviceId: null,
      registrationOptions: undefined
    }
  ])

  renderer.unmount()
})

test('BubblesNotificationsProvider does not automatically enroll from deprecated provider props', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: true,
      userId: LEGACY_USER
    })
  )

  await renderer.flush()

  assert.deepEqual(syncCalls, [])

  await getContextValue(renderer).registerDevice({ userId: EXPLICIT_USER_ID })
  await renderer.flush()

  assert.equal(registerCalls[0]?.userId, EXPLICIT_USER_ID)
  assert.deepEqual(syncCalls, [])

  renderer.unmount()
})

test('BubblesNotificationsProvider setDeviceAttributes posts custom attributes in one request', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123'
  })

  await getContextValue(renderer).registerDevice({ userId: 'user-123' })
  await getContextValue(renderer).setDeviceAttributes({
    plan: {
      tier: 'pro',
      seats: 4
    },
    locale: 'nl-NL'
  })
  await renderer.flush()

  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appKey: APP_KEY,
      deviceId: REGISTERED_DEVICE,
      attributes: {
        plan: {
          tier: 'pro',
          seats: 4
        },
        locale: 'nl-NL'
      }
    }
  ])
  assert.equal(getContextValue(renderer).error, null)

  renderer.unmount()
})

test('BubblesNotificationsProvider supports deprecated addDeviceAttribute calls', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: 'user-123' })
  await getContextValue(renderer).addDeviceAttribute('plan', 'pro')
  await renderer.flush()

  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appKey: APP_KEY,
      deviceId: REGISTERED_DEVICE,
      attributes: {
        plan: 'pro'
      }
    }
  ])

  renderer.unmount()
})

test('BubblesNotificationsProvider setDeviceAttributes waits for the current registration', async () => {
  storedState.deviceId = null
  const renderer = await renderProvider()
  const contextValue = getContextValue(renderer)
  const deferredRegistration = createDeferred<SyncResult>()

  registerState.implementation = async () => deferredRegistration.promise

  const registration = contextValue.registerDevice({ userId: 'user-123' })

  await flushMicrotasks()
  const attributeUpdate = contextValue.setDeviceAttributes({ plan: 'pro' })

  await renderer.flush()

  assert.equal(getContextValue(renderer).isSyncing, true)
  assert.deepEqual(attributeCalls, [])

  deferredRegistration.resolve({
    action: 'created',
    deviceId: REGISTERED_DEVICE,
    pushToken: PUSH_TOKEN,
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  await Promise.all([registration, attributeUpdate])
  await renderer.flush()

  assert.equal(registerCalls[0]?.deviceId, null)
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: API_BASE_URL,
      appKey: APP_KEY,
      deviceId: REGISTERED_DEVICE,
      attributes: {
        plan: 'pro'
      }
    }
  ])
  assert.equal(getContextValue(renderer).error, null)

  renderer.unmount()
})

test('BubblesNotificationsProvider skips queued enrollment after provider configuration changes', async () => {
  const renderer = await renderProvider()
  const contextValue = getContextValue(renderer)
  const deferredRegistration = createDeferred<SyncResult>()

  registerState.implementation = async () => deferredRegistration.promise

  const currentRegistration = contextValue.registerDevice({
    userId: CURRENT_USER
  })

  await flushMicrotasks()
  const staleRegistration = contextValue.registerDevice({
    userId: 'stale-user'
  })

  await renderer.update(createProviderProps({
    appKey: REPLACEMENT_APP_KEY
  }))

  deferredRegistration.resolve({
    action: 'updated',
    deviceId: 'stale-device',
    pushToken: 'stale-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  await Promise.all([currentRegistration, staleRegistration])
  await renderer.flush()

  assert.deepEqual(registerCalls.map((call) => call.userId), [
    CURRENT_USER
  ])
  assert.equal(getContextValue(renderer).isSyncing, false)

  renderer.unmount()
})

test('BubblesNotificationsProvider skips a superseded queued enrollment', async () => {
  const renderer = await renderProvider()
  const contextValue = getContextValue(renderer)

  const supersededRegistration = contextValue.registerDevice({
    userId: 'superseded-user'
  })
  const currentRegistration = contextValue.registerDevice({
    userId: CURRENT_USER
  })

  await Promise.all([supersededRegistration, currentRegistration])
  await renderer.flush()

  assert.deepEqual(registerCalls.map((call) => call.userId), [
    CURRENT_USER
  ])
  assert.equal(getContextValue(renderer).isSyncing, false)

  renderer.unmount()
})

test('BubblesNotificationsProvider addDeviceAttribute rejects before a device id is available', async () => {
  storedState.deviceId = null
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123'
  })

  await assert.rejects(
    () => getContextValue(renderer).addDeviceAttribute('plan', 'pro'),
    /"addDeviceAttribute\(\)" requires a backend "deviceId" before attributes can be synced\./
  )
  await renderer.flush()

  assert.deepEqual(attributeCalls, [])
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "addDeviceAttribute()" requires a backend "deviceId" before attributes can be synced.'
  )

  renderer.unmount()
})

test('BubblesNotificationsProvider addDeviceAttribute rejects undefined values', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123'
  })

  await assert.rejects(
    () => getContextValue(renderer).addDeviceAttribute('plan', undefined),
    /"addDeviceAttribute\(\)" requires "value" to be a JSON-compatible value\./
  )
  await renderer.flush()

  assert.deepEqual(attributeCalls, [])

  renderer.unmount()
})

test('BubblesNotificationsProvider requires explicit enrollment when deprecated readiness changes', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    aliasing: ['alpha'],
    appVersion: '1.0.0'
  })

  assert.deepEqual(syncCalls, [])

  await renderer.update(
    createProviderProps({
      ready: true,
      userId: 'user-123',
      aliasing: ['alpha'],
      appVersion: '1.0.0'
    })
  )

  assert.deepEqual(syncCalls, [])
  assert.deepEqual(registerCalls, [])

  renderer.unmount()
})

test('BubblesNotificationsProvider runs onLogout once when the user transitions from a value to null', async () => {
  const logoutEvents: BubblesNotificationsLogoutEvent[] = []
  const onLogout = async (event: BubblesNotificationsLogoutEvent) => {
    logoutEvents.push(event)
  }
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    onLogout
  })

  assert.deepEqual(logoutEvents, [])

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: '   ',
      onLogout
    })
  )

  assert.deepEqual(logoutEvents, [
    {
      previousUserId: 'user-123',
      deviceId: STORED_DEVICE
    }
  ])

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      onLogout
    })
  )

  assert.equal(logoutEvents.length, 1)

  renderer.unmount()
})

test('BubblesNotificationsProvider handles rejected logout work', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    onLogout: async () => {
      throw new Error('logout failed')
    }
  })

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      onLogout: async () => {
        throw new Error('logout failed')
      }
    })
  )
  await renderer.flush()

  assert.equal(getContextValue(renderer).error, null)
  assert.equal(getContextValue(renderer).isSyncing, false)
  assert.equal(consoleError.mock.calls.length, 1)

  renderer.unmount()
})

test('BubblesNotificationsProvider persists apiBaseUrl changes and re-ensures the default channel', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: null,
    apiBaseUrl: PADDED_PRIMARY_API_BASE_URL
  })

  assert.deepEqual(apiBaseUrlCalls, [PRIMARY_API_BASE_URL])
  assert.deepEqual(appKeyCalls, [APP_KEY])
  assert.equal(ensureChannelCallCount, 1)

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      apiBaseUrl: 'https://api.two.example'
    })
  )
  assert.deepEqual(apiBaseUrlCalls, [
    PRIMARY_API_BASE_URL,
    'https://api.two.example'
  ])
  assert.deepEqual(appKeyCalls, [APP_KEY, APP_KEY])
  assert.equal(ensureChannelCallCount, 2)

  renderer.unmount()
})

test('BubblesNotificationsProvider reuses state only for matching enrollment metadata', async () => {
  const renderer = await renderProvider()
  const enroll = async (options: Record<string, unknown>) => {
    await getContextValue(renderer).registerDevice(options)
    await renderer.flush()

    return registerCalls[registerCalls.length - 1]
  }

  const options = { userId: 'user-123', aliasing: ['primary'], appVersion: '1.0.0' }
  const first = await enroll(options)

  assert.equal(first.previousRegistrationState, undefined)
  const repeat = await enroll({ ...options, aliasing: ['primary'] })

  assert.equal(repeat.previousRegistrationState, grantedRegistrationState)
  const newUser = await enroll({ ...options, userId: OTHER_USER })

  assert.equal(newUser.previousRegistrationState, undefined)
  const newAliases = await enroll({ ...options, userId: OTHER_USER, aliasing: ['other'] })

  assert.equal(newAliases.previousRegistrationState, undefined)
  const newVersion = await enroll({ ...options, userId: OTHER_USER, aliasing: ['other'], appVersion: '2.0.0' })

  assert.equal(newVersion.previousRegistrationState, undefined)

  renderer.unmount()
})

test('abandoned configuration render preserves the committed enrolled session', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: 'committed-user' })
  await renderer.flush()

  renderer.abandonRender(createProviderProps({ appKey: 'abandoned-app-key' }))
  tokenRefreshListener?.(ROTATED_TOKEN)
  await renderer.flush()

  assert.equal(maintenanceCalls.length, 1)
  assert.equal(maintenanceCalls[0]?.appKey, createProviderProps().appKey)
  renderer.unmount()
})

test('abandoned configuration render does not cancel an in-flight enrollment', async () => {
  const renderer = await renderProvider()
  const deferredRegistration = createDeferred<SyncResult>()

  registerState.implementation = async () => deferredRegistration.promise
  const registration = getContextValue(renderer).registerDevice({ userId: 'committed-user' })

  await flushMicrotasks()

  renderer.abandonRender(createProviderProps({ appKey: 'abandoned-app-key' }))
  deferredRegistration.resolve({
    action: 'updated', deviceId: 'committed-device', pushToken: PUSH_TOKEN,
    tokenType: 'fcm', permissionStatus: 'granted', notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  await registration
  await renderer.flush()
  tokenRefreshListener?.(ROTATED_TOKEN)
  await renderer.flush()

  assert.equal(maintenanceCalls[0]?.deviceId, 'committed-device')
  renderer.unmount()
})

test('retained registration callback uses the committed provider configuration', async () => {
  const renderer = await renderProvider()
  const registerDevice = getContextValue(renderer).registerDevice

  await renderer.update(createProviderProps({ appKey: REPLACEMENT_APP_KEY }))
  await registerDevice({ userId: CURRENT_USER })
  await renderer.flush()
  assert.equal(registerCalls[0]?.appKey, REPLACEMENT_APP_KEY)
  renderer.unmount()
})

test('equivalent inline migration configuration retains enrollment and removes bridge observer', async () => {
  const listeners = new Set<(id: string | null) => void>()
  const bridge = { getSubscriptionId: async () => 'player', subscribe: (listener: (id: string | null) => void) => {
    listeners.add(listener)

    return () => { listeners.delete(listener) }
  } }
  const migration = { policy: 'required' as const, oneSignalAppId: 'original', bridge }
  const renderer = await renderProvider({ oneSignalMigration: migration })

  await getContextValue(renderer).registerDevice({ userId: 'user' })
  await renderer.flush()
  await renderer.update(createProviderProps({ oneSignalMigration: { ...migration } }))
  tokenRefreshListener?.('rotated')
  await renderer.flush()
  assert.equal(maintenanceCalls.length, 1)
  assert.equal(listeners.size, 1)
  renderer.unmount()
  assert.equal(listeners.size, 0)
})

test('logout durably marks before draining first enrollment and disables its canonical device', async () => {
  storedState.deviceId = null
  const renderer = await renderProvider()
  const deferred = createDeferred<SyncResult>()
  let registrationIsCurrent: (() => boolean) | undefined

  registerState.implementation = async (options) => {
    registrationIsCurrent = options.isCurrent as () => boolean
    const result = await deferred.promise

    assert.equal(registrationIsCurrent(), true)
    storedState.deviceId = result.deviceId

    return result
  }
  const registration = getContextValue(renderer).registerDevice({ userId: CURRENT_USER })

  await flushMicrotasks()
  const disableTargets: (string | null)[] = []

  retryLogout.mockImplementation(async () => { disableTargets.push(storedState.deviceId) })
  const logout = getContextValue(renderer).logout()

  assert.equal(markLogout.mock.calls.length, 1)
  assert.equal(markLogout.mock.calls[0]?.[1], null)
  assert.equal(registrationIsCurrent?.(), true)
  await renderer.flush()
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  await emitTokenRefresh()
  assert.equal(maintenanceCalls.length, 0)
  assert.deepEqual(disableTargets, [])
  deferred.resolve({
    action: 'created', deviceId: REGISTERED_DEVICE, pushToken: PUSH_TOKEN,
    tokenType: 'fcm', permissionStatus: 'granted', notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  await registration
  await logout
  await renderer.flush()
  assert.equal(disableTargets[0], REGISTERED_DEVICE)
  assert.equal(registrationIsCurrent?.(), false)
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  await emitAppState('background')
  await emitAppState('active')
  await renderer.flush()
  assert.equal(maintenanceCalls.length, 0)
  assert.equal(registerCalls.length, 1)
  renderer.unmount()
})

test('register A in flight, queued B, logout, and register C preserve identity and queue order', async () => {
  const renderer = await renderProvider()
  const deferred = createDeferred<SyncResult>()
  const events: string[] = []

  registerState.implementation = async (options) => {
    const user = options.userId as string

    events.push(user)
    if (user === 'A') {
      const result = await deferred.promise

      assert.equal((options.isCurrent as () => boolean)(), true)
      events.push('A acknowledged')

      return result
    }

    return {
      action: 'updated', deviceId: REGISTERED_DEVICE, pushToken: PUSH_TOKEN,
      tokenType: 'fcm', permissionStatus: 'granted', notificationsEnabled: true,
      registrationState: grantedRegistrationState
    }
  }
  const first = getContextValue(renderer).registerDevice({ userId: 'A' })

  await flushMicrotasks()
  const second = getContextValue(renderer).registerDevice({ userId: 'B' })
  const logout = getContextValue(renderer).logout()
  const third = getContextValue(renderer).registerDevice({ userId: 'C' })

  retryLogout.mockImplementation(async () => { events.push('retry disable') })
  deferred.resolve({
    action: 'created', deviceId: REGISTERED_DEVICE, pushToken: PUSH_TOKEN,
    tokenType: 'fcm', permissionStatus: 'granted', notificationsEnabled: true,
    registrationState: grantedRegistrationState
  })
  await Promise.all([first, second, logout, third])
  await renderer.flush()
  assert.deepEqual(registerCalls.map((options) => options.userId), ['A', 'C'])
  assert.deepEqual(events.slice(0, 3), ['A', 'A acknowledged', 'retry disable'])
  assert.equal(events[events.length - 1], 'C')
  assert.equal(getContextValue(renderer).notificationsEnabled, true)
  await emitTokenRefresh()
  await renderer.flush()
  assert.equal(maintenanceCalls[0]?.userId, 'C')
  renderer.unmount()
})

test('same-user login after logout registers again without session-state deduplication', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  await getContextValue(renderer).logout()
  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  await renderer.flush()
  assert.equal(registerCalls.length, 2)
  assert.equal(registerCalls[1]?.previousRegistrationState, undefined)
  assert.equal(getContextValue(renderer).notificationsEnabled, true)
  renderer.unmount()
})

test('failed logout retries while active and stops its timer in background and on unmount', async () => {
  vi.useFakeTimers()
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  retryLogout.mockRejectedValue(new Error('offline'))
  await assert.rejects(getContextValue(renderer).logout(), /offline/)
  await renderer.flush()
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  assert.equal(vi.getTimerCount(), 1)
  const calls = retryLogout.mock.calls.length

  await vi.advanceTimersByTimeAsync(15000)
  await renderer.flush()
  assert.equal(retryLogout.mock.calls.length, calls + 1)
  assert.equal(vi.getTimerCount(), 1)
  assert.equal(maintenanceCalls.length, 0)
  await emitAppState('background')
  assert.equal(vi.getTimerCount(), 0)
  await emitAppState('active')
  await renderer.flush()
  assert.equal(vi.getTimerCount(), 1)
  renderer.unmount()
  assert.equal(vi.getTimerCount(), 0)
})

test('relogin cannot enroll until a pending logout succeeds and lifecycle retry resumes that login', async () => {
  vi.useFakeTimers()
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  retryLogout.mockRejectedValue(new Error('offline'))
  await assert.rejects(getContextValue(renderer).logout(), /offline/)
  await assert.rejects(getContextValue(renderer).registerDevice({ userId: OTHER_USER }), /offline/)
  await renderer.flush()
  assert.equal(registerCalls.length, 1)
  retryLogout.mockResolvedValue(undefined)
  await vi.advanceTimersByTimeAsync(15000)
  await renderer.flush()
  assert.equal(registerCalls.length, 2)
  assert.equal(registerCalls[1]?.userId, OTHER_USER)
  assert.equal(getContextValue(renderer).notificationsEnabled, true)
  assert.equal(vi.getTimerCount(), 0)
  renderer.unmount()
})

test('logout drains token-refresh maintenance before disabling and never re-enables while signed out', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  const deferred = createDeferred<Awaited<ReturnType<typeof maintenanceState.implementation>>>()

  maintenanceState.implementation = async () => deferred.promise
  await emitTokenRefresh()
  assert.equal(maintenanceCalls.length, 1)
  retryLogout.mockClear()
  const logout = getContextValue(renderer).logout()

  await emitTokenRefresh()
  assert.equal(retryLogout.mock.calls.length, 0)
  deferred.resolve({ registrationState: grantedRegistrationState, syncResult: null })
  await logout
  await renderer.flush()
  assert.equal(retryLogout.mock.calls.length, 1)
  await emitTokenRefresh()
  await renderer.flush()
  assert.equal(maintenanceCalls.length, 1)
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  renderer.unmount()
})

test('immediate cold-start logout marks persisted identity before bootstrap and waits for durable marking', async () => {
  const renderer = new HookRenderer(BubblesNotificationsProvider, createProviderProps())
  const marked = createDeferred<void>()
  let capturedPersistedIdentity: string | null = null

  markLogout.mockImplementation(async () => {
    capturedPersistedIdentity = storedState.deviceId
    await marked.promise
  })
  const mounting = renderer.flush()
  const logout = getContextValue(renderer).logout()

  // The in-memory provider has not hydrated its legacy stored ID yet. The
  // storage helper can atomically bind that ID because marking starts now.
  assert.equal(markLogout.mock.calls[0]?.[1], null)
  assert.equal(capturedPersistedIdentity, STORED_DEVICE)
  await mounting
  assert.equal(retryLogout.mock.calls.length, 0)
  marked.resolve(undefined)
  await logout
  await renderer.flush()
  assert.equal(retryLogout.mock.calls.length > 0, true)
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  assert.equal(registerCalls.length, 0)
  renderer.unmount()
})

test('configuration changes suspend the previous authenticated notification state', async () => {
  permissionState = { granted: true, status: 'granted' }
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  await renderer.flush()
  assert.equal(getContextValue(renderer).notificationsEnabled, true)
  await renderer.update(createProviderProps({ appKey: REPLACEMENT_APP_KEY }))
  assert.equal(getContextValue(renderer).notificationsEnabled, false)
  await emitTokenRefresh()
  await renderer.flush()
  assert.equal(maintenanceCalls.length, 0)
  renderer.unmount()
})

test('a late logout completion from the old configuration drains before the new configuration enrolls', async () => {
  const renderer = await renderProvider()

  await getContextValue(renderer).registerDevice({ userId: CURRENT_USER })
  const disabled = createDeferred<void>()

  retryLogout.mockImplementation(async (configuration) => {
    if ((configuration as { appKey: string }).appKey === APP_KEY) await disabled.promise
  })
  const logout = getContextValue(renderer).logout()

  await flushMicrotasks()
  await renderer.update(createProviderProps({ appKey: REPLACEMENT_APP_KEY }))
  const registration = getContextValue(renderer).registerDevice({ userId: OTHER_USER })

  await flushMicrotasks()
  assert.equal(registerCalls.length, 1)
  disabled.resolve(undefined)
  await logout
  await registration
  await renderer.flush()
  assert.equal(registerCalls.length, 2)
  assert.equal(registerCalls[1]?.appKey, REPLACEMENT_APP_KEY)
  assert.equal(registerCalls[1]?.userId, OTHER_USER)
  assert.equal(getContextValue(renderer).notificationsEnabled, true)
  renderer.unmount()
})
