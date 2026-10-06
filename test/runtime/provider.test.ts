import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type {
  BubblesNotificationsLogoutEvent,
  BubblesNotificationsProviderProps,
} from '../../src/runtime/context.ts';

type Cleanup = (() => void) | void;

interface ProviderContextValue {
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

function areHookDependenciesEqual(
  previous: unknown[] | undefined,
  next: unknown[] | undefined,
): boolean {
  if (previous === undefined || next === undefined) {
    return false;
  }

  if (previous.length !== next.length) {
    return false;
  }

  return next.every((value, index) => Object.is(value, previous[index]));
}

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

function createDeferred<Value>() {
  let resolvePromise!: (value: Value) => void;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

class HookRenderer<Props> {
  private hookIndex = 0;
  private needsRender = false;
  private readonly stateSlots: unknown[] = [];
  private readonly refSlots: Array<{ current: unknown }> = [];
  private readonly memoSlots: Array<{
    deps: unknown[] | undefined;
    value: unknown;
  }> = [];
  private readonly effectSlots: Array<{
    deps: unknown[] | undefined;
    effect: () => Cleanup;
    cleanup?: () => void;
  }> = [];
  private pendingEffectIndexes: number[] = [];

  output:
    | {
        props: {
          value: ProviderContextValue;
        };
      }
    | null = null;

  constructor(
    private readonly component: (props: Props) => unknown,
    private props: Props,
  ) {}

  useState<State>(
    initialState: State | (() => State),
  ): [State, (update: State | ((state: State) => State)) => void] {
    const slotIndex = this.hookIndex;

    if (!(slotIndex in this.stateSlots)) {
      this.stateSlots[slotIndex] =
        typeof initialState === 'function'
          ? (initialState as () => State)()
          : initialState;
    }

    const setState = (
      update: State | ((state: State) => State),
    ) => {
      const currentState = this.stateSlots[slotIndex] as State;
      this.stateSlots[slotIndex] =
        typeof update === 'function'
          ? (update as (state: State) => State)(currentState)
          : update;
      this.needsRender = true;
    };

    this.hookIndex += 1;
    return [this.stateSlots[slotIndex] as State, setState];
  }

  useRef<Value>(initialValue: Value): { current: Value } {
    const slotIndex = this.hookIndex;

    if (!(slotIndex in this.refSlots)) {
      this.refSlots[slotIndex] = {
        current: initialValue,
      };
    }

    this.hookIndex += 1;
    return this.refSlots[slotIndex] as { current: Value };
  }

  useMemo<Value>(factory: () => Value, deps?: unknown[]): Value {
    const slotIndex = this.hookIndex;
    const previousMemo = this.memoSlots[slotIndex];

    if (
      previousMemo === undefined ||
      !areHookDependenciesEqual(previousMemo.deps, deps)
    ) {
      this.memoSlots[slotIndex] = {
        deps,
        value: factory(),
      };
    }

    this.hookIndex += 1;
    return this.memoSlots[slotIndex].value as Value;
  }

  useCallback<Callback extends (...args: any[]) => unknown>(
    callback: Callback,
    deps?: unknown[],
  ): Callback {
    return this.useMemo(() => callback, deps);
  }

  useEffect(
    effect: () => Cleanup,
    deps?: unknown[],
  ): void {
    const slotIndex = this.hookIndex;
    const previousEffect = this.effectSlots[slotIndex];
    const shouldRun =
      previousEffect === undefined ||
      !areHookDependenciesEqual(previousEffect.deps, deps);

    this.effectSlots[slotIndex] = {
      deps,
      effect,
      cleanup: previousEffect?.cleanup,
    };

    if (shouldRun) {
      this.pendingEffectIndexes.push(slotIndex);
    }

    this.hookIndex += 1;
  }

  async flush() {
    let safetyCounter = 0;

    do {
      if (this.output === null || this.needsRender) {
        this.needsRender = false;
        this.render();
        this.runEffects();
      }

      await flushMicrotasks();
      safetyCounter += 1;
    } while (
      (this.needsRender || this.pendingEffectIndexes.length > 0) &&
      safetyCounter < 20
    );

    if (this.needsRender || this.pendingEffectIndexes.length > 0) {
      throw new Error('HookRenderer did not reach a stable state.');
    }
  }

  async mountWithStrictModeEffectReplay() {
    this.render();
    this.runEffects();

    for (const effect of this.effectSlots) {
      effect?.cleanup?.();
    }

    for (const effect of this.effectSlots) {
      if (!effect) {
        continue;
      }

      const cleanup = effect.effect();
      effect.cleanup =
        typeof cleanup === 'function' ? cleanup : undefined;
    }

    await this.flush();
  }

  async update(props: Props) {
    this.props = props;
    this.needsRender = true;
    await this.flush();
  }

  unmount() {
    for (const effect of this.effectSlots) {
      effect?.cleanup?.();
    }
  }

  private render() {
    this.hookIndex = 0;
    activeRenderer = this;

    try {
      this.output = this.component(this.props) as HookRenderer<Props>['output'];
    } finally {
      activeRenderer = null;
    }
  }

  private runEffects() {
    const effectIndexes = [...this.pendingEffectIndexes];
    this.pendingEffectIndexes = [];

    for (const effectIndex of effectIndexes) {
      const effect = this.effectSlots[effectIndex];

      effect?.cleanup?.();

      const cleanup = effect?.effect();
      effect.cleanup =
        typeof cleanup === 'function' ? cleanup : undefined;
    }
  }
}

let activeRenderer: HookRenderer<any> | null = null;

const storedState = {
  deviceId: 'stored-device' as string | null,
};
const apiBaseUrlCalls: string[] = [];
const appKeyCalls: string[] = [];
let ensureChannelCallCount = 0;
const registerCalls: Array<Record<string, unknown>> = [];
const syncCalls: Array<Record<string, unknown>> = [];
const maintenanceCalls: Array<Record<string, unknown>> = [];
const attributeCalls: Array<Record<string, unknown>> = [];
const notificationHandlerCalls: Array<Record<string, unknown> | undefined> = [];
let notificationHandlerAcquireCallCount = 0;
let notificationHandlerReleaseCallCount = 0;
let activeNotificationHandlerOwner: object | null = null;
const responseObserverCalls: Array<Record<string, unknown>> = [];
let responseObserverCleanupCallCount = 0;
const permissionCalls: Array<Record<string, unknown> | undefined> = [];
let permissionState = {
  granted: false,
  status: 'denied',
};
let currentAppState = 'active';
const appStateListeners = new Set<(state: string) => void>();
const deliveryStatusFlushCalls: Array<Record<string, unknown> | undefined> = [];
let deliveryStatusFlushError: Error | null = null;
let tokenRefreshListener: ((token: string) => void) | null = null;
let tokenRefreshCleanupCallCount = 0;
const grantedRegistrationState: RegistrationState = {
  platform: 'ios',
  tokenType: 'fcm',
  token: 'push-token',
  fid: 'fid-123',
  permissionStatus: 'granted',
  notificationsEnabled: true,
};
const registerState: {
  implementation: (
    options: Record<string, unknown>,
  ) => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'created',
    deviceId: 'registered-device',
    pushToken: 'push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState,
  }),
};
const syncState: {
  implementation: (
    options: Record<string, unknown>,
  ) => Promise<SyncResult>;
} = {
  implementation: async () => ({
    action: 'updated',
    deviceId: 'stored-device',
    pushToken: 'stored-push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: {
      ...grantedRegistrationState,
      token: 'stored-push-token',
    },
  }),
};
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
    syncResult: null,
  }),
};

class MockBubblesNotificationsSyncError extends Error {
  readonly snapshot: Record<string, unknown>;
  readonly cause: unknown;

  constructor(
    message: string,
    snapshot: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'BubblesNotificationsSyncError';
    this.snapshot = snapshot;
    this.cause = cause;
  }
}

vi.doMock('react', () => ({
  createContext(defaultValue: unknown) {
    return {
      Provider: Symbol('ContextProvider'),
      defaultValue,
    };
  },
  useEffect(
    effect: () => Cleanup,
    deps?: unknown[],
  ) {
    if (!activeRenderer) {
      throw new Error('useEffect called without an active renderer.');
    }

    activeRenderer.useEffect(effect, deps);
  },
  useCallback<Callback extends (...args: any[]) => unknown>(
    callback: Callback,
    deps?: unknown[],
  ) {
    if (!activeRenderer) {
      throw new Error('useCallback called without an active renderer.');
    }

    return activeRenderer.useCallback(callback, deps);
  },
  useMemo<Value>(factory: () => Value, deps?: unknown[]) {
    if (!activeRenderer) {
      throw new Error('useMemo called without an active renderer.');
    }

    return activeRenderer.useMemo(factory, deps);
  },
  useRef<Value>(initialValue: Value) {
    if (!activeRenderer) {
      throw new Error('useRef called without an active renderer.');
    }

    return activeRenderer.useRef(initialValue);
  },
  useState<State>(initialState: State | (() => State)) {
    if (!activeRenderer) {
      throw new Error('useState called without an active renderer.');
    }

    return activeRenderer.useState(initialState);
  },
}));

const jsxRuntime = {
  Fragment: Symbol.for('Fragment'),
  jsx: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  }),
  jsxDEV: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  }),
  jsxs: (type: unknown, props: Record<string, unknown>) => ({
    type,
    props,
  }),
};

vi.doMock('react/jsx-runtime', () => jsxRuntime);
vi.doMock('react/jsx-dev-runtime', () => jsxRuntime);

vi.doMock('react-native', () => ({
  AppState: {
    get currentState() {
      return currentAppState;
    },
    addEventListener: (
      event: string,
      listener: (state: string) => void,
    ) => {
      assert.equal(event, 'change');
      appStateListeners.add(listener);

      return {
        remove: () => {
          appStateListeners.delete(listener);
        },
      };
    },
  },
}));

vi.doMock('../../src/storage/device-state.ts', () => ({
  readStoredDeviceIdAsync: async () => storedState.deviceId,
  patchStoredDeviceStateAsync: async (
    value: {
      apiBaseUrl?: string | null;
      appKey?: string | null;
    },
  ) => {
    if ('apiBaseUrl' in value) {
      apiBaseUrlCalls.push(value.apiBaseUrl as string);
    }

    if ('appKey' in value) {
      appKeyCalls.push(value.appKey as string);
    }

    return {
      deviceId: storedState.deviceId,
      apiBaseUrl: apiBaseUrlCalls[apiBaseUrlCalls.length - 1] ?? null,
      appKey: appKeyCalls[appKeyCalls.length - 1] ?? null,
    };
  },
}));

vi.doMock('../../src/runtime/register-device.ts', () => ({
  maintainBubblesDevice: async (options: Record<string, unknown>) => {
    maintenanceCalls.push(options);
    return maintenanceState.implementation(options);
  },
  registerBubblesDevice: async (options: Record<string, unknown>) => {
    const recordedOptions = { ...options };
    delete recordedOptions.loadDeviceId;
    registerCalls.push(recordedOptions);
    return registerState.implementation(options);
  },
  syncExistingBubblesDevice: async (options: Record<string, unknown>) => {
    syncCalls.push(options);
    return syncState.implementation(options);
  },
}));

vi.doMock('../../src/notifications/delivery-status.ts', () => ({
  flushStoredBubblesDeliveryStatuses: async (
    storedDeviceState?: Record<string, unknown>,
  ) => {
    deliveryStatusFlushCalls.push(storedDeviceState);

    if (deliveryStatusFlushError) {
      throw deliveryStatusFlushError;
    }
  },
}));

vi.doMock('../../src/api/device-client.ts', () => ({
  updateBubblesDeviceAttributes: async (options: Record<string, unknown>) => {
    attributeCalls.push(options);
  },
}));

vi.doMock('../../src/runtime/presentation.ts', () => ({
  getNotificationPermissions: async (
    options?: Record<string, unknown>,
  ) => {
    permissionCalls.push(options);
    ensureChannelCallCount += 1;
    return permissionState;
  },
  describeNotificationPermissionStatus: (
    permissions: typeof permissionState,
  ) => permissions.status,
  isNotificationPermissionGranted: (
    permissions: typeof permissionState,
  ) => permissions.granted,
  acquireBubblesForegroundPresentation: (owner: object) => {
    if (
      activeNotificationHandlerOwner !== null &&
      activeNotificationHandlerOwner !== owner
    ) {
      throw new Error(
        '[@fishonfire/bubbles-expo] Only one BubblesNotificationsProvider may be mounted at a time.',
      );
    }

    activeNotificationHandlerOwner = owner;
    notificationHandlerAcquireCallCount += 1;

    return () => {
      if (activeNotificationHandlerOwner === owner) {
        activeNotificationHandlerOwner = null;
        notificationHandlerReleaseCallCount += 1;
      }
    };
  },
  updateBubblesForegroundPresentation: (
    owner: object,
    options?: Record<string, unknown>,
  ) => {
    if (activeNotificationHandlerOwner === owner) {
      notificationHandlerCalls.push(options);
    }
  },
  observeBubblesNotificationOpenEvents: (
    options: Record<string, unknown>,
  ) => {
    responseObserverCalls.push(options);

    return () => {
      responseObserverCleanupCallCount += 1;
    };
  },
}));

vi.doMock('../../src/runtime/transport.ts', () => ({
  observeBubblesForegroundRemoteMessages: () => () => undefined,
  observeBubblesDeviceTokenRefresh: (
    listener: (token: string) => void,
  ) => {
    tokenRefreshListener = listener;

    return () => {
      tokenRefreshListener = null;
      tokenRefreshCleanupCallCount += 1;
    };
  },
}));

vi.doMock('../../src/runtime/sync-device.ts', () => ({
  BubblesNotificationsSyncError: MockBubblesNotificationsSyncError,
}));

const { BubblesNotificationsProvider } = await import(
  '../../src/runtime/BubblesNotificationsProvider.tsx'
);

beforeEach(() => {
  storedState.deviceId = 'stored-device';
  apiBaseUrlCalls.length = 0;
  appKeyCalls.length = 0;
  ensureChannelCallCount = 0;
  registerCalls.length = 0;
  syncCalls.length = 0;
  maintenanceCalls.length = 0;
  attributeCalls.length = 0;
  notificationHandlerCalls.length = 0;
  notificationHandlerAcquireCallCount = 0;
  notificationHandlerReleaseCallCount = 0;
  activeNotificationHandlerOwner = null;
  responseObserverCalls.length = 0;
  responseObserverCleanupCallCount = 0;
  permissionCalls.length = 0;
  permissionState = {
    granted: false,
    status: 'denied',
  };
  currentAppState = 'active';
  appStateListeners.clear();
  deliveryStatusFlushCalls.length = 0;
  deliveryStatusFlushError = null;
  tokenRefreshListener = null;
  tokenRefreshCleanupCallCount = 0;
  registerState.implementation = async () => ({
    action: 'created',
    deviceId: 'registered-device',
    pushToken: 'push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState,
  });
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: 'stored-device',
    pushToken: 'stored-push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: {
      ...grantedRegistrationState,
      token: 'stored-push-token',
    },
  });
  maintenanceState.implementation = async () => ({
    registrationState: grantedRegistrationState,
    syncResult: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createProviderProps(
  overrides: Partial<BubblesNotificationsProviderProps> = {},
): BubblesNotificationsProviderProps {
  return {
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    children: 'child',
    ...overrides,
  };
}

async function renderProvider(
  overrides: Partial<BubblesNotificationsProviderProps> = {},
) {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps(overrides),
  );

  await renderer.flush();

  return renderer;
}

function getContextValue(
  renderer: HookRenderer<BubblesNotificationsProviderProps>,
) {
  if (!renderer.output) {
    throw new Error('Provider output was not rendered.');
  }

  return renderer.output.props.value;
}

async function emitAppState(nextAppState: string) {
  currentAppState = nextAppState;

  for (const listener of appStateListeners) {
    listener(nextAppState);
  }

  await flushMicrotasks();
}

async function emitTokenRefresh(token = 'rotated-token') {
  tokenRefreshListener?.(token);
  await flushMicrotasks();
}

test('BubblesNotificationsProvider exposes only supported hook actions and state', async () => {
  const renderer = await renderProvider({
    ready: false,
  });

  assert.deepEqual(Object.keys(getContextValue(renderer)).sort(), [
    'addDeviceAttribute',
    'error',
    'isSyncing',
    'notificationsEnabled',
    'registerDevice',
    'setDeviceAttributes',
  ]);
  assert.deepEqual(syncCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider bootstraps without authentication or prompting for permission', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: null,
  });

  assert.deepEqual(permissionCalls, [
    { requestPermissions: false },
  ]);
  assert.equal(getContextValue(renderer).notificationsEnabled, false);
  assert.deepEqual(registerCalls, []);
  assert.deepEqual(syncCalls, []);
  assert.deepEqual(apiBaseUrlCalls, ['https://api.example.com']);
  assert.equal(ensureChannelCallCount, 1);
  assert.equal(notificationHandlerCalls.length, 1);
  assert.equal(responseObserverCalls.length, 1);

  renderer.unmount();
});

test('BubblesNotificationsProvider flushes stored delivery statuses during startup with complete configuration', async () => {
  const renderer = await renderProvider({
    ready: false,
  });

  assert.deepEqual(deliveryStatusFlushCalls, [
    {
      deviceId: 'stored-device',
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-123',
    },
  ]);

  renderer.unmount();
});

test('BubblesNotificationsProvider flushes stored delivery statuses when the app returns to the foreground', async () => {
  const renderer = await renderProvider({
    ready: false,
  });

  deliveryStatusFlushCalls.length = 0;
  await emitAppState('background');
  await emitAppState('active');

  assert.deepEqual(deliveryStatusFlushCalls, [undefined]);

  renderer.unmount();
  assert.equal(appStateListeners.size, 0);
});

test('BubblesNotificationsProvider does not maintain a device before session enrollment', async () => {
  const renderer = await renderProvider();

  await emitTokenRefresh();
  await emitAppState('background');
  await emitAppState('active');
  await renderer.flush();

  assert.deepEqual(maintenanceCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider keeps startup successful when delivery-status flush fails', async () => {
  deliveryStatusFlushError = new Error('delivery status unavailable');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const renderer = await renderProvider({
    ready: false,
  });

  assert.equal(getContextValue(renderer).error, null);
  assert.equal(ensureChannelCallCount, 1);
  assert.equal(consoleError.mock.calls.length, 1);

  consoleError.mockRestore();
  renderer.unmount();
});

test('BubblesNotificationsProvider starts bootstrap directly', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: false,
    }),
  );

  await renderer.flush();

  assert.equal(responseObserverCalls.length, 1);
  assert.deepEqual(apiBaseUrlCalls, ['https://api.example.com']);
  assert.equal(ensureChannelCallCount, 1);
  renderer.unmount();
});

test('BubblesNotificationsProvider survives Strict Mode effect replay', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: false,
      userId: null,
    }),
  );

  await renderer.mountWithStrictModeEffectReplay();

  assert.equal(getContextValue(renderer).notificationsEnabled, false);
  assert.equal(responseObserverCalls.length, 2);
  assert.equal(responseObserverCleanupCallCount, 1);
  assert.equal(appStateListeners.size, 1);
  assert.equal(notificationHandlerAcquireCallCount, 2);
  assert.equal(notificationHandlerReleaseCallCount, 1);

  renderer.unmount();
});

test('BubblesNotificationsProvider rejects a duplicate mounted provider', async () => {
  const firstRenderer = await renderProvider();
  const duplicateRenderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps(),
  );

  await assert.rejects(
    () => duplicateRenderer.flush(),
    /Only one BubblesNotificationsProvider may be mounted at a time\./,
  );

  assert.equal(notificationHandlerAcquireCallCount, 1);
  assert.equal(notificationHandlerReleaseCallCount, 0);
  assert.equal(responseObserverCalls.length, 1);

  firstRenderer.unmount();
  assert.equal(notificationHandlerReleaseCallCount, 1);
});

test('BubblesNotificationsProvider enrolls explicitly without provider authentication props', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'legacy-user',
    aliasing: ['legacy-alias'],
    appVersion: '0.9.0',
  });

  await getContextValue(renderer).registerDevice({
    userId: ' explicit-user ',
    aliasing: ['explicit-alias'],
    appVersion: '1.0.0',
    requestPermissions: true,
    permissionRequestOptions: {
      ios: {
        allowAlert: true,
      },
    },
  });
  await renderer.flush();

  assert.deepEqual(registerCalls, [
    {
      appId: 'app-123',
      appKey: 'app-key-123',
      apiBaseUrl: 'https://api.example.com',
      userId: 'explicit-user',
      aliasing: ['explicit-alias'],
      appVersion: '1.0.0',
      deviceId: 'stored-device',
      registrationOptions: {
        userId: ' explicit-user ',
        aliasing: ['explicit-alias'],
        appVersion: '1.0.0',
        requestPermissions: true,
        permissionRequestOptions: {
          ios: {
            allowAlert: true,
          },
        },
      },
    },
  ]);
  assert.equal(getContextValue(renderer).error, null);

  renderer.unmount();
});

test('BubblesNotificationsProvider coalesces token refreshes into one post-enrollment maintenance update', async () => {
  const renderer = await renderProvider();

  await getContextValue(renderer).registerDevice({
    userId: 'user-123',
    aliasing: ['primary'],
    appVersion: '1.0.0',
  });
  await renderer.flush();

  const rotatedRegistrationState: RegistrationState = {
    ...grantedRegistrationState,
    token: 'rotated-token',
  };
  maintenanceState.implementation = async () => ({
    registrationState: rotatedRegistrationState,
    syncResult: {
      action: 'updated',
      deviceId: 'registered-device',
      pushToken: 'rotated-token',
      tokenType: 'fcm',
      permissionStatus: 'granted',
      notificationsEnabled: true,
    },
  });

  tokenRefreshListener?.('rotated-token');
  tokenRefreshListener?.('rotated-token');
  await flushMicrotasks();
  await renderer.flush();

  assert.equal(maintenanceCalls.length, 1);
  assert.deepEqual(maintenanceCalls[0], {
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    userId: 'user-123',
    aliasing: ['primary'],
    appVersion: '1.0.0',
    deviceId: 'registered-device',
    previousRegistrationState: grantedRegistrationState,
  });
  renderer.unmount();
  assert.equal(tokenRefreshListener, null);
  assert.equal(tokenRefreshCleanupCallCount > 0, true);
});

test('BubblesNotificationsProvider performs one follow-up check for maintenance requested in flight', async () => {
  const renderer = await renderProvider();

  await getContextValue(renderer).registerDevice({ userId: 'user-123' });
  await renderer.flush();

  const firstMaintenance = createDeferred<{
    registrationState: RegistrationState;
    syncResult: Omit<SyncResult, 'registrationState'> | null;
  }>();
  const firstRotatedState = {
    ...grantedRegistrationState,
    token: 'first-rotated-token',
  };
  const secondRotatedState = {
    ...grantedRegistrationState,
    token: 'second-rotated-token',
  };
  maintenanceState.implementation = async () => {
    if (maintenanceCalls.length === 1) {
      return firstMaintenance.promise;
    }

    return {
      registrationState: secondRotatedState,
      syncResult: {
        action: 'updated',
        deviceId: 'registered-device',
        pushToken: 'second-rotated-token',
        tokenType: 'fcm',
        permissionStatus: 'granted',
        notificationsEnabled: true,
      },
    };
  };

  await emitTokenRefresh('first-rotated-token');
  assert.equal(maintenanceCalls.length, 1);

  await emitTokenRefresh('second-rotated-token');
  await emitTokenRefresh('second-rotated-token');
  firstMaintenance.resolve({
    registrationState: firstRotatedState,
    syncResult: {
      action: 'updated',
      deviceId: 'registered-device',
      pushToken: 'first-rotated-token',
      tokenType: 'fcm',
      permissionStatus: 'granted',
      notificationsEnabled: true,
    },
  });
  await flushMicrotasks();
  await renderer.flush();

  assert.equal(maintenanceCalls.length, 2);
  assert.equal(
    maintenanceCalls[1]?.previousRegistrationState,
    firstRotatedState,
  );
  renderer.unmount();
});

test('BubblesNotificationsProvider rechecks changed permissions after enrollment on foreground', async () => {
  const renderer = await renderProvider();

  await getContextValue(renderer).registerDevice({ userId: 'user-123' });
  await renderer.flush();

  const deniedRegistrationState: RegistrationState = {
    platform: 'ios',
    tokenType: null,
    token: null,
    fid: null,
    permissionStatus: 'denied',
    notificationsEnabled: false,
  };
  maintenanceState.implementation = async () => ({
    registrationState: deniedRegistrationState,
    syncResult: {
      action: 'updated',
      deviceId: 'registered-device',
      pushToken: null,
      tokenType: null,
      permissionStatus: 'denied',
      notificationsEnabled: false,
    },
  });

  await emitAppState('background');
  await emitAppState('active');
  await renderer.flush();

  assert.equal(maintenanceCalls.length, 1);
  assert.equal(getContextValue(renderer).notificationsEnabled, false);

  renderer.unmount();
});

test('BubblesNotificationsProvider maintains a compatibly enrolled device after token refresh', async () => {
  const renderer = await renderProvider({
    ready: true,
    userId: 'legacy-user',
    aliasing: ['legacy'],
  });

  await getContextValue(renderer).registerDevice();
  await renderer.flush();
  await emitTokenRefresh();
  await renderer.flush();

  assert.equal(maintenanceCalls.length, 1);
  assert.equal(maintenanceCalls[0]?.userId, 'legacy-user');
  assert.deepEqual(maintenanceCalls[0]?.aliasing, ['legacy']);

  renderer.unmount();
});

test('BubblesNotificationsProvider registerDevice rejects an empty explicit userId', async () => {
  const renderer = await renderProvider();

  await assert.rejects(
    () => getContextValue(renderer).registerDevice({ userId: '   ' }),
    /"registerDevice\(options\)" requires a non-empty "userId"\./,
  );
  await renderer.flush();

  assert.deepEqual(registerCalls, []);
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "registerDevice(options)" requires a non-empty "userId".',
  );

  renderer.unmount();
});

test('BubblesNotificationsProvider supports deprecated provider enrollment props', async () => {
  storedState.deviceId = null;
  const renderer = await renderProvider({
    ready: true,
    userId: ' legacy-user ',
    aliasing: ['legacy-alias'],
    appVersion: '0.9.0',
  });

  await getContextValue(renderer).registerDevice();
  await renderer.flush();

  assert.deepEqual(registerCalls, [
    {
      appId: 'app-123',
      appKey: 'app-key-123',
      apiBaseUrl: 'https://api.example.com',
      userId: 'legacy-user',
      aliasing: ['legacy-alias'],
      appVersion: '0.9.0',
      deviceId: null,
      registrationOptions: undefined,
    },
  ]);

  renderer.unmount();
});

test('BubblesNotificationsProvider does not automatically enroll from deprecated provider props', async () => {
  const renderer = new HookRenderer(
    BubblesNotificationsProvider,
    createProviderProps({
      ready: true,
      userId: 'legacy-user',
    }),
  );

  await renderer.flush();

  assert.deepEqual(syncCalls, []);

  await getContextValue(renderer).registerDevice({ userId: 'explicit-user' });
  await renderer.flush();

  assert.equal(registerCalls[0]?.userId, 'explicit-user');
  assert.deepEqual(syncCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider setDeviceAttributes posts custom attributes in one request', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
  });

  await getContextValue(renderer).setDeviceAttributes({
    plan: {
      tier: 'pro',
      seats: 4,
    },
    locale: 'nl-NL',
  });
  await renderer.flush();

  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-123',
      deviceId: 'stored-device',
      attributes: {
        plan: {
          tier: 'pro',
          seats: 4,
        },
        locale: 'nl-NL',
      },
    },
  ]);
  assert.equal(getContextValue(renderer).error, null);

  renderer.unmount();
});

test('BubblesNotificationsProvider supports deprecated addDeviceAttribute calls', async () => {
  const renderer = await renderProvider();

  await getContextValue(renderer).addDeviceAttribute('plan', 'pro');
  await renderer.flush();

  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-123',
      deviceId: 'stored-device',
      attributes: {
        plan: 'pro',
      },
    },
  ]);

  renderer.unmount();
});

test('BubblesNotificationsProvider setDeviceAttributes waits for the current registration', async () => {
  storedState.deviceId = null;
  const renderer = await renderProvider();
  const contextValue = getContextValue(renderer);
  const deferredRegistration = createDeferred<SyncResult>();
  registerState.implementation = async () => deferredRegistration.promise;

  const registration = contextValue.registerDevice({ userId: 'user-123' });
  await flushMicrotasks();
  const attributeUpdate = contextValue.setDeviceAttributes({ plan: 'pro' });
  await renderer.flush();

  assert.equal(getContextValue(renderer).isSyncing, true);
  assert.deepEqual(attributeCalls, []);

  deferredRegistration.resolve({
    action: 'created',
    deviceId: 'registered-device',
    pushToken: 'push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState,
  });
  await Promise.all([registration, attributeUpdate]);
  await renderer.flush();

  assert.equal(registerCalls[0]?.deviceId, null);
  assert.deepEqual(attributeCalls, [
    {
      apiBaseUrl: 'https://api.example.com',
      appKey: 'app-key-123',
      deviceId: 'registered-device',
      attributes: {
        plan: 'pro',
      },
    },
  ]);
  assert.equal(getContextValue(renderer).error, null);

  renderer.unmount();
});

test('BubblesNotificationsProvider skips queued enrollment after provider configuration changes', async () => {
  const renderer = await renderProvider();
  const contextValue = getContextValue(renderer);
  const deferredRegistration = createDeferred<SyncResult>();
  registerState.implementation = async () => deferredRegistration.promise;

  const currentRegistration = contextValue.registerDevice({
    userId: 'current-user',
  });
  await flushMicrotasks();
  const staleRegistration = contextValue.registerDevice({
    userId: 'stale-user',
  });

  await renderer.update(createProviderProps({
    appKey: 'replacement-app-key',
  }));

  deferredRegistration.resolve({
    action: 'updated',
    deviceId: 'stale-device',
    pushToken: 'stale-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
    registrationState: grantedRegistrationState,
  });
  await Promise.all([currentRegistration, staleRegistration]);
  await renderer.flush();

  assert.deepEqual(registerCalls.map((call) => call.userId), [
    'current-user',
  ]);
  assert.equal(getContextValue(renderer).isSyncing, false);

  renderer.unmount();
});

test('BubblesNotificationsProvider skips a superseded queued enrollment', async () => {
  const renderer = await renderProvider();
  const contextValue = getContextValue(renderer);

  const supersededRegistration = contextValue.registerDevice({
    userId: 'superseded-user',
  });
  const currentRegistration = contextValue.registerDevice({
    userId: 'current-user',
  });

  await Promise.all([supersededRegistration, currentRegistration]);
  await renderer.flush();

  assert.deepEqual(registerCalls.map((call) => call.userId), [
    'current-user',
  ]);
  assert.equal(getContextValue(renderer).isSyncing, false);

  renderer.unmount();
});

test('BubblesNotificationsProvider addDeviceAttribute rejects before a device id is available', async () => {
  storedState.deviceId = null;
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
  });

  await assert.rejects(
    () => getContextValue(renderer).addDeviceAttribute('plan', 'pro'),
    /"addDeviceAttribute\(\)" requires a backend "deviceId" before attributes can be synced\./,
  );
  await renderer.flush();

  assert.deepEqual(attributeCalls, []);
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "addDeviceAttribute()" requires a backend "deviceId" before attributes can be synced.',
  );

  renderer.unmount();
});

test('BubblesNotificationsProvider addDeviceAttribute rejects undefined values', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
  });

  await assert.rejects(
    () => getContextValue(renderer).addDeviceAttribute('plan', undefined),
    /"addDeviceAttribute\(\)" requires "value" to be a JSON-compatible value\./,
  );
  await renderer.flush();

  assert.deepEqual(attributeCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider requires explicit enrollment when deprecated readiness changes', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    aliasing: ['alpha'],
    appVersion: '1.0.0',
  });

  assert.deepEqual(syncCalls, []);

  await renderer.update(
    createProviderProps({
      ready: true,
      userId: 'user-123',
      aliasing: ['alpha'],
      appVersion: '1.0.0',
    }),
  );

  assert.deepEqual(syncCalls, []);
  assert.deepEqual(registerCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider runs onLogout once when the user transitions from a value to null', async () => {
  const logoutEvents: BubblesNotificationsLogoutEvent[] = [];
  const onLogout = async (event: BubblesNotificationsLogoutEvent) => {
    logoutEvents.push(event);
  };
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    onLogout,
  });

  assert.deepEqual(logoutEvents, []);

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: '   ',
      onLogout,
    }),
  );

  assert.deepEqual(logoutEvents, [
    {
      previousUserId: 'user-123',
      deviceId: 'stored-device',
    },
  ]);

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      onLogout,
    }),
  );

  assert.equal(logoutEvents.length, 1);

  renderer.unmount();
});

test('BubblesNotificationsProvider handles rejected logout work', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    onLogout: async () => {
      throw new Error('logout failed');
    },
  });

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      onLogout: async () => {
        throw new Error('logout failed');
      },
    }),
  );
  await renderer.flush();

  assert.equal(getContextValue(renderer).error, null);
  assert.equal(getContextValue(renderer).isSyncing, false);
  assert.equal(consoleError.mock.calls.length, 1);

  renderer.unmount();
});

test('BubblesNotificationsProvider persists apiBaseUrl changes and re-ensures the default channel', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: null,
    apiBaseUrl: ' https://api.one.example ',
  });

  assert.deepEqual(apiBaseUrlCalls, ['https://api.one.example']);
  assert.deepEqual(appKeyCalls, ['app-key-123']);
  assert.equal(ensureChannelCallCount, 1);

  await renderer.update(
    createProviderProps({
      ready: false,
      userId: null,
      apiBaseUrl: 'https://api.two.example',
    }),
  );
  assert.deepEqual(apiBaseUrlCalls, [
    'https://api.one.example',
    'https://api.two.example',
  ]);
  assert.deepEqual(appKeyCalls, ['app-key-123', 'app-key-123']);
  assert.equal(ensureChannelCallCount, 2);

  renderer.unmount();
});

test('BubblesNotificationsProvider reuses state only for matching enrollment metadata', async () => {
  const renderer = await renderProvider();
  const enroll = async (options: Record<string, unknown>) => {
    await getContextValue(renderer).registerDevice(options);
    await renderer.flush();
    return registerCalls[registerCalls.length - 1];
  };

  const options = { userId: 'user-123', aliasing: ['primary'], appVersion: '1.0.0' };
  const first = await enroll(options);
  assert.equal(first.previousRegistrationState, undefined);
  const repeat = await enroll({ ...options, aliasing: ['primary'] });
  assert.equal(repeat.previousRegistrationState, grantedRegistrationState);
  const newUser = await enroll({ ...options, userId: 'other-user' });
  assert.equal(newUser.previousRegistrationState, undefined);
  const newAliases = await enroll({ ...options, userId: 'other-user', aliasing: ['other'] });
  assert.equal(newAliases.previousRegistrationState, undefined);
  const newVersion = await enroll({ ...options, userId: 'other-user', aliasing: ['other'], appVersion: '2.0.0' });
  assert.equal(newVersion.previousRegistrationState, undefined);

  renderer.unmount();
});
