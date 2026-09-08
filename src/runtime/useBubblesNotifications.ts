import { useContext } from 'react';

import { BubblesNotificationsContext } from './context';

function fail(message: string): never {
  throw new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

export function useBubblesNotifications() {
  const context = useContext(BubblesNotificationsContext);

  if (context === null) {
    fail(
      '"useBubblesNotifications()" must be used inside "BubblesNotificationsProvider".',
    );
  }

  return context;
}
