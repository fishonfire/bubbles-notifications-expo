# bubbles-npm-get-device-token

Small helper package for getting native push notification tokens in Expo apps with `expo-notifications`.

## Important iOS limitation

Using `expo-notifications`:

- **Android**: `getDevicePushTokenAsync()` returns the **FCM token**.
- **iOS**: `getDevicePushTokenAsync()` returns the **APNs token**, **not** the Firebase Cloud Messaging registration token.

If you need a **true iOS FCM token**, `expo-notifications` alone is not enough. You would typically need Firebase Messaging in a custom native setup, such as `@react-native-firebase/messaging`.

## Installation

```bash
npm install bubbles-npm-get-device-token expo-notifications
```

You also need to configure push notifications in your Expo app according to Expo's docs.

## Usage

```ts
import { getDeviceToken, getFCMToken } from 'bubbles-npm-get-device-token';

const tokenInfo = await getDeviceToken();
console.log(tokenInfo);
// Android => { platform: 'android', tokenType: 'fcm', token: '...' }
// iOS => { platform: 'ios', tokenType: 'apns', token: '...' }

const androidFcmToken = await getFCMToken();
console.log(androidFcmToken);
```

## API

### `getDeviceToken(options?)`

Requests notification permissions by default, then returns the native push token for the current device.

```ts
const result = await getDeviceToken({
  requestPermissions: true,
});
```

Returns:

```ts
{
  platform: 'android' | 'ios';
  tokenType: 'fcm' | 'apns';
  token: string;
}
```

### `getFCMToken(options?)`

- On **Android**, returns the FCM token string.
- On **iOS**, throws an error explaining that `expo-notifications` only exposes the APNs token.

## Example

```ts
try {
  const result = await getDeviceToken();

  if (result.tokenType === 'fcm') {
    console.log('FCM token:', result.token);
  } else {
    console.log('APNs token:', result.token);
  }
} catch (error) {
  console.error('Failed to get push token:', error);
}
```

## Publishing

```bash
npm run build
npm publish
```
