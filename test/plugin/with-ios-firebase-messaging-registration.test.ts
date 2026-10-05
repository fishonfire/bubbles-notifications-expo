import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  setFirebaseMessagingInstallationIdEnabled,
  updateObjcAppDelegateRegistration,
  updateSwiftAppDelegateRegistration,
} from '../../plugin/src/with-ios-firebase-messaging-registration.ts';

const swiftAppDelegate = `import Expo
import React

@UIApplicationMain
class AppDelegate: ExpoAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

const objcAppDelegate = `#import "AppDelegate.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

@end
`;

test('setFirebaseMessagingInstallationIdEnabled toggles the Info.plist key', () => {
  assert.deepEqual(
    setFirebaseMessagingInstallationIdEnabled({ Existing: 'keep' }, true),
    {
      Existing: 'keep',
      FirebaseMessagingInstallationIdEnabled: true,
    },
  );

  assert.deepEqual(
    setFirebaseMessagingInstallationIdEnabled(
      {
        Existing: 'keep',
        FirebaseMessagingInstallationIdEnabled: true,
      },
      false,
    ),
    {
      Existing: 'keep',
    },
  );
});

test('updateSwiftAppDelegateRegistration injects and removes FID registration startup code', () => {
  const enabled = updateSwiftAppDelegateRegistration(swiftAppDelegate, true);

  assert.match(enabled, /import FirebaseCore/);
  assert.match(enabled, /import FirebaseMessaging/);
  assert.match(enabled, /FirebaseApp\.configure\(\)/);
  assert.match(enabled, /Messaging\.messaging\(\)\.register/);

  const disabled = updateSwiftAppDelegateRegistration(enabled, false);

  assert.doesNotMatch(disabled, /@fishonfire\/bubbles-expo-ios-firebase-messaging-registration/);
  assert.doesNotMatch(disabled, /Messaging\.messaging\(\)\.register/);
});

test('updateObjcAppDelegateRegistration injects and removes FID registration startup code', () => {
  const enabled = updateObjcAppDelegateRegistration(objcAppDelegate, true);

  assert.match(enabled, /#import <FirebaseCore\/FirebaseCore\.h>/);
  assert.match(enabled, /#import <FirebaseMessaging\/FirebaseMessaging\.h>/);
  assert.match(enabled, /\[FIRApp configure\]/);
  assert.match(enabled, /\[\[FIRMessaging messaging\] registerWithCompletion:/);

  const disabled = updateObjcAppDelegateRegistration(enabled, false);

  assert.doesNotMatch(disabled, /@fishonfire\/bubbles-expo-ios-firebase-messaging-registration/);
  assert.doesNotMatch(disabled, /registerWithCompletion/);
});
