import { ConfigPlugin } from 'expo/config-plugins';

import {
  BubblesNotificationsExpoPluginConfig,
  normalizePluginConfig,
} from './config';

import withFirebaseMessagingManifest from './with-firebase-messaging-manifest';
import withFirebaseMessagingRegistration from './with-firebase-messaging-registration';
import withIosFirebaseMessagingRegistration from './with-ios-firebase-messaging-registration';
import withExpoNotifications from './with-expo-notifications';
import withRuntimeDefaults from './with-runtime-defaults';
import withRNFBMessagingMainThreadPatch from './with-rnfb-messaging-main-thread-patch';
import withRNFirebaseDisableSPM from './with-rnfirebase-disable-spm';

const withBubblesNotificationsExpo: ConfigPlugin<
  BubblesNotificationsExpoPluginConfig | void
> = (config, input) => {
  const options = normalizePluginConfig(input);

  config = withRuntimeDefaults(config, options);
  config = withExpoNotifications(config, options);
  config = withFirebaseMessagingManifest(config, options);
  config = withRNFBMessagingMainThreadPatch(config);
  config = withRNFirebaseDisableSPM(config);
  config = withIosFirebaseMessagingRegistration(config, options);
  config = withFirebaseMessagingRegistration(config, options);

  return config;
};

export default withBubblesNotificationsExpo;
