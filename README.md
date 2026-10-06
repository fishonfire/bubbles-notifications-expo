# @fishonfire/bubbles-expo

`@fishonfire/bubbles-expo` is an Expo package for integrating Bubbles push notifications into an Expo app.

Upgrading an existing integration? See the [migration guide](./MIGRATION.md).

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
- `enableFirebaseInstallationPushRegistration`: Opt into FID-based Firebase Messaging registration. Default: `false`.

For Android remote display, backend payloads must use the same `android.notification.channel_id` as `defaultChannelId`. The plugin writes Firebase's default-channel manifest metadata, and the package creates the actual Android notification channel when `BubblesNotificationsProvider`, `getNotificationPermissions()`, or `ensureDefaultNotificationChannel()` runs. On a fresh install, the app must be opened at least once before remote notifications can reliably use this configured channel; otherwise Android/Firebase may fall back to its own default behavior before JavaScript has created the channel.

Device registration sends both Firebase identifiers during migration. By default, `push_token` is the Firebase Messaging token returned by `getToken()`, while `fid` is the Firebase Installation ID. This lets Bubbles match imported FCM-token devices and also start storing FIDs for a later migration. When `enableFirebaseInstallationPushRegistration` is set to `true`, Android and iOS opt into FID-based Firebase Messaging registration, native startup code calls Firebase Messaging registration automatically, and the FID becomes the value sent as both `push_token` and `fid`. `getFCMToken()` remains an FCM-only compatibility helper regardless of this flag.

The plugin always patches React Native Firebase Messaging's synchronous UIKit registration checks to use Firebase's APNs-token state instead, and disables RNFirebase Swift Package Manager integration so Xcode builds the patched CocoaPods source. This avoids blocking the JavaScript thread on a synchronous main-queue hop while Firebase Messaging constants are exported or an FCM token is requested. The source patch is intentionally limited to `@react-native-firebase/messaging >=26.3.3 <27.0.0`; re-check the upstream Objective-C++ implementation before widening that range.

When the FID option is enabled, the plugin additionally adds Android and iOS startup registration because Firebase Messaging must begin the FID registration flow before JavaScript runs.

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

The provider starts its installation-level bootstrap immediately. It persists API configuration, installs notification observers and foreground presentation, loads the stored device identity, reads the current notification permission without prompting, and flushes eligible pending delivery statistics. Authentication is not required for this startup work.

Mount exactly one `BubblesNotificationsProvider`. The package owns Expo's process-global notification handler and installs it once for the lifetime of the JavaScript process. Provider unmount removes package listeners but intentionally does not clear the global handler, because another part of the app may have replaced it. Do not also call `Notifications.setNotificationHandler()` elsewhere; configure foreground behavior with the provider's `foregroundPresentation` prop.

## Delivery statistics

Delivery statistics are durable, bounded, and retried at least once when device configuration is available. Their client-side meanings are:

- `received`: a JavaScript Firebase handler observed the remote message.
- `shown`: the app successfully requested local display through `expo-notifications`; it does not confirm that the operating system displayed or the user saw the notification.
- `clicked`: Expo observed a user response to the notification.
- `disabled`: notification permission was unavailable when background handling checked it.

These observations depend on JavaScript execution. In particular, iOS can display a normal visible notification while the app is terminated without running JavaScript, so client-side `received` and `shown` statistics cannot be guaranteed for that state. Use provider-side delivery receipts or backend integration when stronger delivery guarantees are required.

## Register the device

Call `registerDevice(options)` after authentication identifies the user. Enrollment is explicit and the `userId` is not persisted, so call it for each authenticated session:

```tsx
import { Button } from 'react-native';
import { useBubblesNotifications } from '@fishonfire/bubbles-expo';

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
```

Repeated enrollment in the same mounted provider rechecks notification permissions and token state, but skips backend registration when the user, aliases, app version, provider configuration, and registration state are unchanged. Enrollment completes after the backend device ID is stored; delivery-status flushing and built-in device attribute synchronization continue independently. Custom `setDeviceAttributes()` requests still await enrollment, but do not await those follow-up tasks. A new provider session enrolls again.

`useBubblesNotifications()` exposes `registerDevice`, `setDeviceAttributes`, `notificationsEnabled`, `isSyncing`, and `error`. The deprecated `addDeviceAttribute` adapter remains available for existing integrations. Device identifiers, token details, and detailed permission status are managed internally.

`requestPermissions` defaults to `false`. Set it to `true` only from a user-initiated flow where opening the system permission prompt is appropriate. You can customize that request with `permissionRequestOptions`.

The previous provider-level `ready`, `userId`, `aliasing`, `appVersion`, and `onLogout` props are deprecated compatibility adapters. Existing integrations may temporarily keep those props and call `registerDevice()` without arguments, but should migrate enrollment data into `registerDevice(options)`. There is no new logout/detach API because the package has no defined backend detach behavior; consuming apps should handle their own logout policy.

## Set custom device attributes

After `registerDevice()` succeeds, apps can update one or more custom device attributes in a single request:

```tsx
const { setDeviceAttributes } = useBubblesNotifications();

void setDeviceAttributes({
  plan: {
    tier: 'pro',
    seats: 4,
  },
  locale: 'nl-NL',
});
```

`addDeviceAttribute(name, value)` is deprecated; use `setDeviceAttributes({ [name]: value })` instead.

## Public API

The package root contains the supported application API: the provider and hook, background bootstrap, notification permission and channel helpers, the FCM compatibility helper, and their public types. Storage, delivery-ledger, payload-normalization, raw device-client, and provider-state internals are not part of the root API.

Existing integrations that still read the package's stored device configuration or call `updateBubblesDeviceAttributes()` directly can temporarily import those deprecated APIs from `@fishonfire/bubbles-expo/compat`. Migrate attribute updates to `useBubblesNotifications().setDeviceAttributes()` and avoid depending on stored configuration; the compatibility subpath will be removed in a future breaking release.

## Example application
An example application can be found at: https://github.com/fishonfire/bubbles-notifications-expo-example

## Contributors
- Simon de la Court (https://github.com/simondelacourt)
- Jan Deen (https://github.com/Jan-F15H)
- Menno Jongejan (https://github.com/mennolpFoF)

## Copyright and Licence
Copyright (c) 2026, Fish on Fire.

Source code is licensed under the [GNU General Public License v3.0](https://github.com/fishonfire/bubbles-notifications-expo/blob/develop/LICENSE).

Published packages contain the compiled runtime, compiled config plugin, `app.plugin.js`, this README, the migration guide, and the license. Local `npm pack` archives are generated release artifacts and are not committed.
