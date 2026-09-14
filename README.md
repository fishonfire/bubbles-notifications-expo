# @fishonfire/bubbles-expo

`@fishonfire/bubbles-expo` is an Expo package for integrating Bubbles push notifications into an Expo app.

It provides:

- an Expo config plugin for notification setup
- an explicit background registration API for Firebase notification handling
- a React provider and hook for Bubbles device registration and notification responses

## Installation

```bash
npm install @fishonfire/bubbles-expo
npx expo install expo-notifications @react-native-firebase/app @react-native-firebase/installations @react-native-firebase/messaging
```

Add your Firebase service files to Expo config:

```json
{
  "expo": {
    "android": {
      "googleServicesFile": "./google-services.json"
    },
    "ios": {
      "googleServicesFile": "./GoogleService-Info.plist"
    }
  }
}
```

Use a development build or release build for push notification testing. Expo Go does not include the required native Firebase modules.
For iOS, also complete Firebase Messaging and APNs setup in the consuming app.

## Configure the plugin

Add the required plugins in `app.json` or `app.config.ts`:

```json
{
  "expo": {
    "plugins": [
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      [
        "@fishonfire/bubbles-expo",
        {
          "defaultChannelId": "default",
          "defaultChannelName": "Default",
          "androidChannelImportance": "max",
          "androidNotificationIcon": "./assets/notification-icon.png",
          "androidNotificationColor": "#208AEF",
          "enableBackgroundRemoteNotifications": true
        }
      ]
    ]
  }
}
```

Plugin options:

- `defaultChannelId`: Android default notification channel id. Default: `"default"`.
- `defaultChannelName`: Android default notification channel name. Default: `"Default"`.
- `androidChannelImportance`: Android channel importance. One of `min`, `low`, `default`, `high`, or `max`. Default: `"max"`.
- `androidNotificationIcon`: Optional Android notification icon path.
- `androidNotificationColor`: Optional Android notification color in `#RRGGBB` or `#AARRGGBB` format.
- `enableBackgroundRemoteNotifications`: Passed through to `expo-notifications`. Default: `true`.

For Android remote display, backend payloads must use the same `android.notification.channel_id` as `defaultChannelId`. The plugin writes Firebase's default-channel manifest metadata, and the package creates the actual Android notification channel when `BubblesNotificationsProvider`, `getNotificationPermissions()`, or `ensureDefaultNotificationChannel()` runs. On a fresh install, the app must be opened at least once before remote notifications can reliably use this configured channel; otherwise Android/Firebase may fall back to its own default behavior before JavaScript has created the channel.

## Background registration

Register the package-owned background notification handlers once from your app entrypoint:

```ts
import { registerBubblesBackgroundHandlers } from '@fishonfire/bubbles-expo';

registerBubblesBackgroundHandlers();
```

Do this as early as possible, especially if your app loads notification UI lazily. `BubblesNotificationsProvider` does not register background handlers for you.

The registered background path uses React Native Firebase for remote delivery and is intended for silent/data processing plus Android data-only local presentation when your product explicitly supports it. It is not the delivery mechanism for normal visible iOS notifications. User-visible iOS pushes must use the normal visible payload with APNs alert fields so the OS can display them while the app is backgrounded or terminated.

`expo-notifications` still owns local presentation, permissions, channels, and response handling.

If you prefer a side-effect-only bootstrap module, the compatibility entrypoint is still available:

```ts
import '@fishonfire/bubbles-expo/register-task';
```

Only use the compatibility entrypoint once, from the app entrypoint or another module imported by the entrypoint. Do not wait for React providers, navigation, or authenticated app state before registering background handlers.

## Wrap your app

Wrap your app with `BubblesNotificationsProvider`:

```tsx
import {
  BubblesNotificationsProvider,
  type BubblesNotificationResponseEvent,
} from '@fishonfire/bubbles-expo';
import { router, type Href } from 'expo-router';

function handleNotificationResponse(event: BubblesNotificationResponseEvent) {
  if (event.url) {
    router.push(event.url as Href);
  }
}

export function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <BubblesNotificationsProvider
      appId="your-app-id"
      appKey="your-app-key"
      apiBaseUrl="https://api.example.com"
      ready={true}
      userId="current-user-id"
      aliasing={['customer-123']}
      onNotificationResponse={handleNotificationResponse}>
      {children}
    </BubblesNotificationsProvider>
  );
}
```

Required provider props:

- `appId`: Bubbles app id.
- `appKey`: Bubbles app key used to verify the configured app id.
- `apiBaseUrl`: Bubbles API base URL.
- `ready`: Set to `true` when auth and app state are ready for registration.
- `userId`: Current signed-in user id, or `null` when signed out.

## Register the device

Call `registerDevice()` when the app is ready and the user is signed in:

```tsx
import { Button } from 'react-native';
import { useBubblesNotifications } from '@fishonfire/bubbles-expo';

export function EnableNotificationsButton() {
  const { registerDevice, isSyncing } = useBubblesNotifications();

  return (
    <Button
      title="Enable notifications"
      disabled={isSyncing}
      onPress={() => {
        void registerDevice();
      }}
    />
  );
}
```

`useBubblesNotifications()` also exposes `deviceId`, `pushToken`, `permissionStatus`, `notificationsEnabled`, `tokenType`, and `error`.

If your app already requested notification permissions, call `registerDevice({ requestPermissions: false })`.

## Example application
A example application can be found at: https://github.com/fishonfire/bubbles-notifications-expo-example

## Contributors
- Simon de la Court (https://github.com/simondelacourt)
- Jan Deen (https://github.com/Jan-F15H)
- Menno Jongejan (https://github.com/mennolpFoF)

## Copyright and Licence
Copyright (c) 2026, Fish on Fire.

Source code is licensed under the [`GPL License`](https://github.com/fishonfire/bubbles-notifications-expo/blob/develop/LICENSE).