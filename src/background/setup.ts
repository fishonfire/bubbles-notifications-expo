import {
  registerBubblesFirebaseBackgroundMessageHandler,
} from './firebase-message-handler';

let hasRegisteredBubblesBackgroundHandlers = false;

export function registerBubblesBackgroundHandlers(): void {
  if (hasRegisteredBubblesBackgroundHandlers) {
    return;
  }

  registerBubblesFirebaseBackgroundMessageHandler();
  hasRegisteredBubblesBackgroundHandlers = true;
}
