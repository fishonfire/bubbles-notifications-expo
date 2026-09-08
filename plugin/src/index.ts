import { ConfigPlugin } from 'expo/config-plugins';

import {
  BubblesNotificationsExpoPluginConfig,
  normalizePluginConfig,
} from './config';

import withFirebaseMessagingManifest from './with-firebase-messaging-manifest';
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
  config = withRNFirebaseDisableSPM(config);

  return config;
};

export default withBubblesNotificationsExpo;
