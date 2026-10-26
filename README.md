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

`useBubblesNotifications()` exposes `registerDevice`, `logout`, `setDeviceAttributes`, `notificationsEnabled`, `isSyncing`, and `error`. The deprecated `addDeviceAttribute` adapter remains available for existing integrations. Device identifiers, token details, and detailed permission status are managed internally.

`requestPermissions` defaults to `false`. Set it to `true` only from a user-initiated flow where opening the system permission prompt is appropriate. You can customize that request with `permissionRequestOptions`.

The previous provider-level `ready`, `userId`, `aliasing`, `appVersion`, and `onLogout` props are deprecated compatibility adapters. Existing integrations may temporarily keep those props and call `registerDevice()` without arguments, but should migrate enrollment data into `registerDevice(options)`. Call the explicit `logout()` method when the host authentication session ends; the deprecated `onLogout` prop remains a callback for legacy integrations.

## Log out the device

Call `logout()` when the host authentication session ends, including a signed-out
startup. It stops enrollment retries and token/foreground maintenance immediately,
then waits for in-flight registration to store its canonical device ID before
updating that device with `notifications_enabled: false`. It preserves the
installation identity, user association, and imported OneSignal subscription ID.

```tsx
const { logout } = useBubblesNotifications();

await logout();
```

Await completion before unmounting the provider. A failed request rejects and
remains persisted for retry at startup, on foreground activation, and every 15
seconds while the app is active. New `registerDevice(options)` calls process any
pending device disable before enrolling the next authenticated session. Calling
`logout()` repeatedly is safe. Successful enrollment restores notification
eligibility according to OS permission; logout does not revoke OS permission.

The host still owns its auth state, foreground presentation policy, and clearing
already displayed notifications. This method cannot recall pushes already handed
to APNs/FCM, update the backend while offline, or resolve an imported device that
has not yet acquired a local canonical Bubbles ID. Platform administrative test
sends may bypass notification eligibility. Verify migration and logout with native
builds and the deployed backend before rollout.

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

## Development

Run `npm run lint` to check authored JavaScript and TypeScript in the runtime, config plugin, tests, and package configuration. Run `npm run lint:fix` to apply automatic fixes. Both commands require zero warnings; generated `dist/` and `plugin/build/` files are excluded.

Linting follows [eslint-config-fishonfire](https://github.com/fishonfire/eslint-config-fishonfire), including React, Hooks, and SonarJS rules, on top of Expo's defaults. The config preserves its TypeScript ESLint 5 recommended rules using TypeScript ESLint 8 equivalents where rules were retired, keeping compatibility with Expo 57.

Run `npm run typecheck`, `npm test`, and `npm run build` for the remaining development checks.

## Contributors
- Simon de la Court (https://github.com/simondelacourt)
- Jan Deen (https://github.com/Jan-F15H)
- Menno Jongejan (https://github.com/mennolpFoF)

## Copyright and Licence
Copyright (c) 2026, Fish on Fire.

Source code is licensed under the [GNU General Public License v3.0](https://github.com/fishonfire/bubbles-notifications-expo/blob/develop/LICENSE).

Published packages contain the compiled runtime, compiled config plugin, `app.plugin.js`, this README, the migration guide, and the license. Local `npm pack` archives are generated release artifacts and are not committed.

## Migrating imported OneSignal devices

Deploy the backend identity migration before upgrading this package. Every runtime registration now sends a persisted `installation_id` UUID independently of Firebase's `fid`, permissions, token rotation, and login changes. Registration first performs a POST reconciliation, validates the canonical response ID and accepted identities, and persists the binding before sending attributes or delivery statuses. Subsequent updates retain that canonical ID. Invalid identity responses and backend identity conflicts fail enrollment without an identity-free retry.

For an app cohort imported from OneSignal, retain and initialize the original OneSignal SDK in the host app, and pass an adapter for its **push subscription ID** (the imported `player_id`). The package does not initialize or depend on OneSignal. Adapt these methods to the exact SDK version used by your host:

```tsx
import type { OneSignalMigrationBridge } from '@fishonfire/bubbles-expo';

// Keep this adapter object stable (e.g. module scope or useMemo).
const bridge: OneSignalMigrationBridge = {
  getSubscriptionId: async () => readExistingPushSubscriptionId(),
  subscribe: (listener) => observePushSubscriptionChanges(listener),
};

<BubblesNotificationsProvider
  appId={42}
  appKey={appKey}
  apiBaseUrl={apiBaseUrl}
  oneSignalMigration={{
    policy: 'required',
    oneSignalAppId: originalOneSignalAppId,
    bridge,
    readinessTimeoutMs: 3000,
  }}
>
  <App />
</BubblesNotificationsProvider>
```

The example host functions must read the existing push subscription and return an unsubscribe callback. Do not supply a OneSignal user ID, external user ID, Firebase token, or a new subscription created by resetting the original SDK. Verify the mapping against real Android/iOS exports.

Continue calling `registerDevice({ userId })` after authentication. Required migration waits up to the configured timeout (0–30000 ms); a missing ID rejects with `BubblesMigrationPendingError` and remains pending. Subscription readiness, foreground activation, and token refresh retry the last enrollment. No backend create occurs while legacy identity is unresolved. A captured ID survives network errors, and a valid acknowledged binding keeps working when the bridge is removed. The original accepted subscription is retained if OneSignal later reports a different subscription; the provider reports a reconciliation error.

For known fresh installations and apps without imported devices, select `oneSignalMigration={{ policy: 'disabled' }}`. Omission keeps this disabled behavior for compatibility. The consuming app must classify its migration cohort deliberately: absence of Bubbles storage does not distinguish a fresh install from an imported device. Do not switch unresolved imported devices to disabled mode to bypass readiness.

Bindings are scoped to normalized backend URL plus Bubbles app ID; app-key rotation retains the UUID and binding. Storage schema v1 and legacy device IDs remain readable, but require an initial canonical handshake. Corrupt registration metadata preserves the separate UUID. A corrupt UUID, or a missing UUID for an acknowledged binding, fails closed and requires explicit host/operator recovery. Resolve the original installation identity before removing its file; deleting it alone can create a new identity and requires controlled backend reconciliation.

Native rebuilds are required for the new Expo Crypto dependency. Identity and metadata currently use the app document directory. The host must configure and validate backup exclusions for `bubbles-notifications-installation-id.txt`, `bubbles-notifications-expo-state.json`, their temporary/recovery files, and the delivery-status ledger on both platforms. This package does not currently apply native backup exclusions. Without a verified host backup policy, a device restore can clone an installation UUID; reinstall/new-device uniqueness is not guaranteed. Test upgrade, uninstall/reinstall, clear-data and cross-device backup/restore on real native builds before rollout.

Pending delivery statuses retain their original scoped device binding. Historical unbound statuses and statuses belonging to a different canonical device remain queued until ledger expiry rather than being reassigned during migration. Backend/operator reconciliation must decide how to handle their history. Native end-to-end push delivery and cohort validation remain rollout checks; JavaScript unit tests do not establish those guarantees.
