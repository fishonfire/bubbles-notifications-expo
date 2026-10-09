import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

let tokenRefreshListener: ((token: string) => void) | null = null;
let unsubscribeCallCount = 0;

vi.doMock('@react-native-firebase/messaging', () => ({
  getMessaging: () => ({ app: 'messaging' }),
  onTokenRefresh: (
    _messaging: unknown,
    listener: (token: string) => void,
  ) => {
    tokenRefreshListener = listener;

    return () => {
      unsubscribeCallCount += 1;
      tokenRefreshListener = null;
    };
  },
}));

vi.doMock('../../src/runtime/tokens.ts', () => ({}));
vi.doMock('../../src/runtime/installations.ts', () => ({}));

const { observeBubblesDeviceTokenRefresh } = await import(
  '../../src/runtime/transport.ts'
);

beforeEach(() => {
  tokenRefreshListener = null;
  unsubscribeCallCount = 0;
});

test('observeBubblesDeviceTokenRefresh forwards rotations and disposes the Firebase listener', async () => {
  const tokens: string[] = [];
  const unsubscribe = observeBubblesDeviceTokenRefresh((token) => {
    tokens.push(token);
  });

  await vi.waitFor(() => {
    assert.notEqual(tokenRefreshListener, null);
  });
  tokenRefreshListener?.('rotated-token');

  assert.deepEqual(tokens, ['rotated-token']);

  unsubscribe();

  assert.equal(unsubscribeCallCount, 1);
  assert.equal(tokenRefreshListener, null);
});
