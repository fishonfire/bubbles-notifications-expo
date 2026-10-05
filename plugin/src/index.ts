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
import withRNFirebaseDisableSPM from './with-rnfirebase-disable-spm';

const withBubblesNotificationsExpo: ConfigPlugin<
  BubblesNotificationsExpoPluginConfig | void
> = (config, input) => {
  const options = normalizePluginConfig(input);

  config = withRuntimeDefaults(config, options);
  config = withExpoNotifications(config, options);
  config = withFirebaseMessagingManifest(config, options);
  config = withIosFirebaseMessagingRegistration(config, options);
  if (options.enableFirebaseInstallationPushRegistration) {
    config = withFirebaseMessagingRegistration(config, options);
  }
  config = withRNFirebaseDisableSPM(config);

  return config;
};

export default withBubblesNotificationsExpo;
