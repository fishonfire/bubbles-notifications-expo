import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const backgroundRegistrationCalls = {
  firebase: 0,
};

vi.doMock('../../src/background/firebase-message-handler.ts', () => ({
  registerBubblesFirebaseBackgroundMessageHandler: () => {
    backgroundRegistrationCalls.firebase += 1;
  },
}));

beforeEach(() => {
  vi.resetModules();
  backgroundRegistrationCalls.firebase = 0;
});

test('registerBubblesBackgroundHandlers delegates to the Firebase bootstrap once', async () => {
  const {
    registerBubblesBackgroundHandlers,
  } = await import('../../src/background/setup.ts');

  registerBubblesBackgroundHandlers();
  registerBubblesBackgroundHandlers();

  assert.equal(backgroundRegistrationCalls.firebase, 1);
});

test('register-task entrypoint registers background handlers on import', async () => {
  await import('../../src/register-task.ts');

  assert.equal(backgroundRegistrationCalls.firebase, 1);
});
