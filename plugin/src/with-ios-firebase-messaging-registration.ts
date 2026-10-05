import {
  ConfigPlugin,
  WarningAggregator,
  withAppDelegate,
  withInfoPlist,
} from 'expo/config-plugins';
import type { InfoPlist } from '@expo/config-plugins/build/ios/IosConfig.types';
import { mergeContents, removeContents } from '@expo/config-plugins/build/utils/generateCode';

import type {
  NormalizedBubblesNotificationsExpoPluginConfig,
} from './config';

const FIREBASE_MESSAGING_INSTALLATION_ID_ENABLED =
  'FirebaseMessagingInstallationIdEnabled';

const IOS_REGISTRATION_TAG =
  '@fishonfire/bubbles-expo-ios-firebase-messaging-registration';

const SWIFT_REGISTRATION_BLOCK = `if FirebaseApp.app() == nil {
      FirebaseApp.configure()
    }

    Messaging.messaging().register { error in
      if let error = error {
        NSLog("[BubblesNotifications] Failed to start Firebase Messaging registration: \\(error.localizedDescription)")
      }
    }`;

const OBJC_REGISTRATION_BLOCK = `if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }

  [[FIRMessaging messaging] registerWithCompletion:^(NSError * _Nullable error) {
    if (error != nil) {
      NSLog(@"[BubblesNotifications] Failed to start Firebase Messaging registration: %@", error.localizedDescription);
    }
  }];`;

function addImport(
  contents: string,
  importLine: string,
  existingImportMatcher: RegExp,
  preferredAnchorMatcher: RegExp,
  anyImportMatcher: RegExp,
): string {
  if (existingImportMatcher.test(contents)) {
    return contents;
  }

  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const preferredAnchor = preferredAnchorMatcher.exec(contents);
  if (preferredAnchor?.index !== undefined) {
    const insertionPoint = preferredAnchor.index + preferredAnchor[0].length;
    return `${contents.slice(0, insertionPoint)}${newline}${importLine}${contents.slice(insertionPoint)}`;
  }

  const firstImport = anyImportMatcher.exec(contents);
  if (firstImport?.index !== undefined) {
    return `${contents.slice(0, firstImport.index)}${importLine}${newline}${contents.slice(firstImport.index)}`;
  }

  return `${importLine}${newline}${contents}`;
}

function removeGeneratedRegistration(contents: string): string {
  return removeContents({
    src: contents,
    tag: IOS_REGISTRATION_TAG,
  }).contents;
}

export function setFirebaseMessagingInstallationIdEnabled(
  infoPlist: InfoPlist,
  enabled: boolean,
): InfoPlist {
  if (enabled) {
    return {
      ...infoPlist,
      [FIREBASE_MESSAGING_INSTALLATION_ID_ENABLED]: true,
    };
  }

  const nextInfoPlist = { ...infoPlist };
  delete nextInfoPlist[FIREBASE_MESSAGING_INSTALLATION_ID_ENABLED];
  return nextInfoPlist;
}

export function updateSwiftAppDelegateRegistration(
  contents: string,
  enabled: boolean,
): string {
  const withoutGeneratedRegistration = removeGeneratedRegistration(contents);

  if (!enabled) {
    return withoutGeneratedRegistration;
  }

  let nextContents = addImport(
    withoutGeneratedRegistration,
    'import FirebaseCore',
    /^[ \t]*import\s+FirebaseCore[ \t]*$/m,
    /^[ \t]*import\s+Expo[ \t]*$/m,
    /^[ \t]*import\b[^\r\n]*$/m,
  );
  nextContents = addImport(
    nextContents,
    'import FirebaseMessaging',
    /^[ \t]*import\s+FirebaseMessaging[ \t]*$/m,
    /^[ \t]*import\s+FirebaseCore[ \t]*$/m,
    /^[ \t]*import\b[^\r\n]*$/m,
  );

  try {
    return mergeContents({
      tag: IOS_REGISTRATION_TAG,
      src: nextContents,
      newSrc: SWIFT_REGISTRATION_BLOCK,
      anchor:
        /func\s+application\([^)]*didFinishLaunchingWithOptions[^)]*\)\s*->\s*Bool\s*{/,
      offset: 1,
      comment: '//',
    }).contents;
  } catch {
    WarningAggregator.addWarningIOS(
      '@fishonfire/bubbles-expo',
      'Unable to determine correct Firebase Messaging registration insertion point in AppDelegate.swift. Skipping iOS FID registration startup code.',
    );
    return nextContents;
  }
}

export function updateObjcAppDelegateRegistration(
  contents: string,
  enabled: boolean,
): string {
  const withoutGeneratedRegistration = removeGeneratedRegistration(contents);

  if (!enabled) {
    return withoutGeneratedRegistration;
  }

  let nextContents = addImport(
    withoutGeneratedRegistration,
    '#import <FirebaseCore/FirebaseCore.h>',
    /^[ \t]*#import\s+<FirebaseCore\/FirebaseCore\.h>[ \t]*$/m,
    /^[ \t]*#import\s+"AppDelegate\.h"[ \t]*$/m,
    /^[ \t]*#import\b[^\r\n]*$/m,
  );
  nextContents = addImport(
    nextContents,
    '#import <FirebaseMessaging/FirebaseMessaging.h>',
    /^[ \t]*#import\s+<FirebaseMessaging\/FirebaseMessaging\.h>[ \t]*$/m,
    /^[ \t]*#import\s+<FirebaseCore\/FirebaseCore\.h>[ \t]*$/m,
    /^[ \t]*#import\b[^\r\n]*$/m,
  );

  try {
    return mergeContents({
      tag: IOS_REGISTRATION_TAG,
      src: nextContents,
      newSrc: OBJC_REGISTRATION_BLOCK,
      anchor:
        /-\s*\(BOOL\)\s*application:\s*\(UIApplication\s*\*\s*\)\w+\s+didFinishLaunchingWithOptions:/,
      offset: 1,
      comment: '//',
    }).contents;
  } catch {
    WarningAggregator.addWarningIOS(
      '@fishonfire/bubbles-expo',
      'Unable to determine correct Firebase Messaging registration insertion point in AppDelegate.m. Skipping iOS FID registration startup code.',
    );
    return nextContents;
  }
}

const withIosFirebaseMessagingRegistration: ConfigPlugin<
  NormalizedBubblesNotificationsExpoPluginConfig
> = (config, options) => {
  config = withInfoPlist(config, config => {
    config.modResults = setFirebaseMessagingInstallationIdEnabled(
      config.modResults,
      options.enableFirebaseInstallationPushRegistration,
    );
    return config;
  });

  return withAppDelegate(config, config => {
    const { language, contents } = config.modResults;

    if (language === 'swift') {
      config.modResults.contents = updateSwiftAppDelegateRegistration(
        contents,
        options.enableFirebaseInstallationPushRegistration,
      );
      return config;
    }

    if (language === 'objc' || language === 'objcpp') {
      config.modResults.contents = updateObjcAppDelegateRegistration(
        contents,
        options.enableFirebaseInstallationPushRegistration,
      );
      return config;
    }

    throw new Error(
      `[@fishonfire/bubbles-expo] Cannot configure iOS Firebase Messaging registration for AppDelegate language "${language}".`,
    );
  });
};

export default withIosFirebaseMessagingRegistration;
