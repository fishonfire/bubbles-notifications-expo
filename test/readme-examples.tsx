import type { ReactNode } from 'react';
import { Button } from 'react-native';

import {
  BubblesNotificationsProvider,
  type BubblesNotificationResponseEvent,
  useBubblesNotifications,
} from '../src/index';

const router = {
  push: (_url: string) => undefined,
};

function handleNotificationResponse(event: BubblesNotificationResponseEvent) {
  if (event.url) {
    router.push(event.url);
  }
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BubblesNotificationsProvider
      appId="your-app-id"
      appKey="your-app-key"
      apiBaseUrl="https://api.example.com"
      onNotificationResponse={handleNotificationResponse}>
      {children}
    </BubblesNotificationsProvider>
  );
}

export function EnableNotificationsButton({ userId }: { userId: string }) {
  const { registerDevice, isSyncing } = useBubblesNotifications();

  return (
    <Button
      title="Enable notifications"
      disabled={isSyncing}
      onPress={() => {
        void registerDevice({
          userId,
          aliasing: ['customer-123'],
          appVersion: '1.0.0',
          requestPermissions: true,
        });
      }}
    />
  );
}

export function DeviceAttributesExample() {
  const { setDeviceAttributes } = useBubblesNotifications();

  return (
    <Button
      title="Update notification profile"
      onPress={() => {
        void setDeviceAttributes({
          plan: {
            tier: 'pro',
            seats: 4,
          },
          locale: 'nl-NL',
        });
      }}
    />
  );
}
