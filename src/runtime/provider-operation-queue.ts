import {
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { BubblesNotificationsSyncError } from './sync-device';
import {
  getRuntimeStateUpdate,
  normalizeProviderError,
  type BubblesNotificationsRuntimeState,
  type RuntimeOperation,
} from './provider-state';

export function useBubblesRuntimeOperationQueue(
  setState: Dispatch<
    SetStateAction<BubblesNotificationsRuntimeState>
  >,
) {
  const isMountedRef = useRef(true);
  const pendingOperationsRef = useRef(0);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueOperation = useCallback((
    operation: RuntimeOperation,
  ): Promise<void> => {
    pendingOperationsRef.current += 1;

    setState((currentState) => ({
      ...currentState,
      isSyncing: true,
      error: null,
    }));

    const queuedOperation = operationQueueRef.current
      .catch(() => undefined)
      .then(operation);

    operationQueueRef.current = queuedOperation.then(
      () => undefined,
      () => undefined,
    );

    return queuedOperation.then(
      (result) => {
        pendingOperationsRef.current -= 1;

        if (!isMountedRef.current) {
          return;
        }

        setState((currentState) => ({
          ...currentState,
          ...(result ?? {}),
          isSyncing: pendingOperationsRef.current > 0,
          error: null,
        }));
      },
      (error) => {
        pendingOperationsRef.current -= 1;
        const normalizedError = normalizeProviderError(error);
        const snapshot =
          error instanceof BubblesNotificationsSyncError
            ? error.snapshot
            : undefined;

        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            ...(snapshot ? getRuntimeStateUpdate(snapshot) : {}),
            isSyncing: pendingOperationsRef.current > 0,
            error: normalizedError,
          }));
        }

        throw normalizedError;
      },
    );
  }, [setState]);

  return {
    enqueueOperation,
    isMountedRef,
  };
}
