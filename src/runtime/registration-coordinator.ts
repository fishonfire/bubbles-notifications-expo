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
  type RuntimeStateUpdate,
} from './provider-state';

type RegistrationOperation = () => Promise<RuntimeStateUpdate | void>;

export function useBubblesRegistrationCoordinator(
  setState: Dispatch<
    SetStateAction<BubblesNotificationsRuntimeState>
  >,
) {
  const isMountedRef = useRef(true);
  const pendingRegistrationsRef = useRef(0);
  const currentRegistrationRef = useRef<Promise<void> | null>(null);

  const runRegistration = useCallback((
    operation: RegistrationOperation,
  ): Promise<void> => {
    pendingRegistrationsRef.current += 1;

    setState((currentState) => ({
      ...currentState,
      isSyncing: true,
      error: null,
    }));

    const previousRegistration = currentRegistrationRef.current;
    const registration = (previousRegistration ?? Promise.resolve())
      .then(operation)
      .then(
        (result) => {
          if (!isMountedRef.current) {
            return;
          }

          setState((currentState) => ({
            ...currentState,
            ...(result ?? {}),
            error: null,
          }));
        },
        (error) => {
          const normalizedError = normalizeProviderError(error);
          const snapshot =
            error instanceof BubblesNotificationsSyncError
              ? error.snapshot
              : undefined;

          if (isMountedRef.current) {
            setState((currentState) => ({
              ...currentState,
              ...(snapshot ? getRuntimeStateUpdate(snapshot) : {}),
              error: normalizedError,
            }));
          }

          throw normalizedError;
        },
      )
      .finally(() => {
        pendingRegistrationsRef.current -= 1;

        if (isMountedRef.current) {
          setState((currentState) => ({
            ...currentState,
            isSyncing: pendingRegistrationsRef.current > 0,
          }));
        }
      });
    const registrationCompletion = registration.then(
      () => undefined,
      () => undefined,
    );

    currentRegistrationRef.current = registrationCompletion;
    void registrationCompletion.then(() => {
      if (currentRegistrationRef.current === registrationCompletion) {
        currentRegistrationRef.current = null;
      }
    });

    return registration;
  }, [setState]);

  const waitForCurrentRegistration = useCallback(async (): Promise<void> => {
    await currentRegistrationRef.current;
  }, []);

  return {
    isMountedRef,
    runRegistration,
    waitForCurrentRegistration,
  };
}
