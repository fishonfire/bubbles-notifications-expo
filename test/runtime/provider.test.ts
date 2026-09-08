import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

import type {
  BubblesNotificationsLogoutEvent,
  BubblesNotificationsProviderProps,
} from '../../src/runtime/context.ts';

type Cleanup = (() => void) | void;

interface ProviderContextValue {
  registerDevice: (
    options?: Record<string, unknown>,
  ) => Promise<void>;
  deviceId: string | null;
  pushToken: string | null;
  tokenType: string | null;
  permissionStatus: string;
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

class HookRenderer<Props> {
  private hookIndex = 0;
  private needsRender = false;
  private readonly stateSlots: unknown[] = [];
  private readonly refSlots: Array<{ current: unknown }> = [];
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
const notificationHandlerCalls: Array<Record<string, unknown> | undefined> = [];
let clearNotificationHandlerCallCount = 0;
const responseObserverCalls: Array<Record<string, unknown>> = [];
let responseObserverCleanupCallCount = 0;
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

vi.doMock('../../src/storage/device-state.ts', () => ({
  readStoredDeviceId: () => storedState.deviceId,
  storeApiBaseUrl: (value: string) => {
    apiBaseUrlCalls.push(value);
    return {
      deviceId: storedState.deviceId,
      apiBaseUrl: value,
      appKey: appKeyCalls[appKeyCalls.length - 1] ?? null,
    };
  },
  storeAppKey: (value: string) => {
    appKeyCalls.push(value);
    return {
      deviceId: storedState.deviceId,
      apiBaseUrl: apiBaseUrlCalls[apiBaseUrlCalls.length - 1] ?? null,
      appKey: value,
    };
  },
}));

vi.doMock('../../src/runtime/register-device.ts', () => ({
  registerBubblesDevice: async (options: Record<string, unknown>) => {
    registerCalls.push(options);
    return registerState.implementation(options);
  },
}));

vi.doMock('../../src/runtime/presentation.ts', () => ({
  prepareBubblesNotificationPresentation: async () => {
    ensureChannelCallCount += 1;
    return null;
  },
  applyBubblesForegroundPresentation: (
    options?: Record<string, unknown>,
  ) => {
    notificationHandlerCalls.push(options);
  },
  clearBubblesForegroundPresentation: () => {
    clearNotificationHandlerCallCount += 1;
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
}));

vi.doMock('../../src/runtime/sync-device.ts', () => ({
  BubblesNotificationsSyncError: MockBubblesNotificationsSyncError,
  syncExistingBubblesDevice: async (options: Record<string, unknown>) => {
    syncCalls.push(options);
    return syncState.implementation(options);
  },
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
  notificationHandlerCalls.length = 0;
  clearNotificationHandlerCallCount = 0;
  responseObserverCalls.length = 0;
  responseObserverCleanupCallCount = 0;
  registerState.implementation = async () => ({
    action: 'created',
    deviceId: 'registered-device',
    pushToken: 'push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
  syncState.implementation = async () => ({
    action: 'updated',
    deviceId: 'stored-device',
    pushToken: 'stored-push-token',
    tokenType: 'fcm',
    permissionStatus: 'granted',
    notificationsEnabled: true,
  });
});

function createProviderProps(
  overrides: Partial<BubblesNotificationsProviderProps> = {},
): BubblesNotificationsProviderProps {
  return {
    appId: 'app-123',
    appKey: 'app-key-123',
    apiBaseUrl: 'https://api.example.com',
    ready: false,
    userId: 'user-123',
    aliasing: ['alpha'],
    appVersion: '1.0.0',
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

test('BubblesNotificationsProvider exposes the initially stored device id before any sync runs', async () => {
  const renderer = await renderProvider({
    ready: false,
  });

  assert.equal(getContextValue(renderer).deviceId, 'stored-device');
  assert.deepEqual(syncCalls, []);

  renderer.unmount();
});

test('BubblesNotificationsProvider registerDevice rejects when ready is false', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
  });

  await assert.rejects(
    () => getContextValue(renderer).registerDevice(),
    /"registerDevice\(\)" requires "ready" to be true before the device can be synced\./,
  );
  await renderer.flush();

  assert.deepEqual(registerCalls, []);
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "registerDevice()" requires "ready" to be true before the device can be synced.',
  );

  renderer.unmount();
});

test('BubblesNotificationsProvider registerDevice rejects when userId normalizes to null', async () => {
  const renderer = await renderProvider({
    ready: true,
    userId: '   ',
  });

  await assert.rejects(
    () => getContextValue(renderer).registerDevice(),
    /"registerDevice\(\)" requires a non-null "userId" before the device can be synced\./,
  );
  await renderer.flush();

  assert.deepEqual(registerCalls, []);
  assert.equal(
    getContextValue(renderer).error?.message,
    '[@fishonfire/bubbles-expo] "registerDevice()" requires a non-null "userId" before the device can be synced.',
  );

  renderer.unmount();
});

test('BubblesNotificationsProvider only auto-syncs once for an unchanged automatic-sync signature', async () => {
  const renderer = await renderProvider({
    ready: false,
    userId: 'user-123',
    aliasing: ['alpha'],
  });

  assert.deepEqual(syncCalls, []);

  await renderer.update(
    createProviderProps({
      ready: true,
      userId: 'user-123',
      aliasing: ['alpha'],
    }),
  );

  assert.deepEqual(syncCalls, [
    {
      appId: 'app-123',
      appKey: 'app-key-123',
      apiBaseUrl: 'https://api.example.com',
      userId: 'user-123',
      aliasing: ['alpha'],
      appVersion: '1.0.0',
      deviceId: 'stored-device',
    },
  ]);

  await renderer.update(
    createProviderProps({
      ready: true,
      userId: 'user-123',
      aliasing: ['alpha'],
    }),
  );

  assert.equal(syncCalls.length, 1);

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
