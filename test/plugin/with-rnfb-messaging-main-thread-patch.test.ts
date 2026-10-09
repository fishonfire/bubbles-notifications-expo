import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  isSupportedRNFBMessagingVersion,
  patchRNFBMessagingModuleSource,
} from '../../plugin/src/with-rnfb-messaging-main-thread-patch.ts';

const rnfbMessagingModule = `#import <React/RCTUtils.h>

@implementation RNFBMessagingModule

- (NSDictionary *)messagingConstantsDictionary {
#if TARGET_IPHONE_SIMULATOR
  constants[@"isRegisteredForRemoteNotifications"] = @NO;
#else
  constants[@"isRegisteredForRemoteNotifications"] = @(
      [RCTConvert BOOL:@([[UIApplication sharedApplication] isRegisteredForRemoteNotifications])]);
#endif
  return constants;
}

- (void)getToken:(NSString *)appName
        senderId:(NSString *)senderId
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  if ([UIApplication sharedApplication].isRegisteredForRemoteNotifications == NO) {
    return;
  }
}

- (void)unregisterForRemoteNotifications:(RCTPromiseResolveBlock)resolve
                                  reject:(RCTPromiseRejectBlock)reject {
  [[UIApplication sharedApplication] unregisterForRemoteNotifications];
  resolve(nil);
}

@end
`;

const legacyPatchedHelpers = `static BOOL RNFBMessagingIsRegisteredForRemoteNotifications() {
#if TARGET_IPHONE_SIMULATOR
  return NO;
#else
  __block BOOL isRegisteredForRemoteNotifications = NO;
  if ([NSThread isMainThread]) {
    isRegisteredForRemoteNotifications =
        [[UIApplication sharedApplication] isRegisteredForRemoteNotifications];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      isRegisteredForRemoteNotifications =
          [[UIApplication sharedApplication] isRegisteredForRemoteNotifications];
    });
  }
  return isRegisteredForRemoteNotifications;
#endif
}

static void RNFBMessagingUnregisterForRemoteNotifications() {
  if ([NSThread isMainThread]) {
    [[UIApplication sharedApplication] unregisterForRemoteNotifications];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      [[UIApplication sharedApplication] unregisterForRemoteNotifications];
    });
  }
}

`;

test('isSupportedRNFBMessagingVersion allows guarded RNFB Messaging versions', () => {
  assert.equal(isSupportedRNFBMessagingVersion('26.3.2'), false);
  assert.equal(isSupportedRNFBMessagingVersion('26.3.3'), true);
  assert.equal(isSupportedRNFBMessagingVersion('26.4.0'), true);
  assert.equal(isSupportedRNFBMessagingVersion('26.4.0-beta.1'), true);
  assert.equal(isSupportedRNFBMessagingVersion('27.0.0'), false);
});

test('patchRNFBMessagingModuleSource avoids synchronous cross-thread UIApplication reads', () => {
  const patched = patchRNFBMessagingModuleSource(rnfbMessagingModule);

  assert.match(
    patched,
    /static BOOL RNFBMessagingIsRegisteredForRemoteNotifications\(\)/,
  );
  assert.match(
    patched,
    /static void RNFBMessagingUnregisterForRemoteNotifications\(\)/,
  );
  assert.match(
    patched,
    /return \[FIRMessaging messaging\]\.APNSToken != nil;/,
  );
  assert.match(
    patched,
    /dispatch_async\(dispatch_get_main_queue\(\), \^\{\s+\[\[UIApplication sharedApplication\] unregisterForRemoteNotifications\];\s+\}\);/,
  );
  assert.doesNotMatch(patched, /dispatch_sync\(/);
  assert.match(
    patched,
    /constants\[@"isRegisteredForRemoteNotifications"\] = @\(\s+\[RCTConvert BOOL:@\(RNFBMessagingIsRegisteredForRemoteNotifications\(\)\)\]\);/,
  );
  assert.match(
    patched,
    /if \(RNFBMessagingIsRegisteredForRemoteNotifications\(\) == NO\)/,
  );
  assert.match(
    patched,
    /-\s*\(void\)unregisterForRemoteNotifications[\s\S]*RNFBMessagingUnregisterForRemoteNotifications\(\);[\s\S]*resolve\(nil\);/,
  );
  assert.doesNotMatch(
    patched,
    /\[\[UIApplication sharedApplication\] isRegisteredForRemoteNotifications\]/,
  );

  assert.equal(patchRNFBMessagingModuleSource(patched), patched);
});

test('patchRNFBMessagingModuleSource upgrades the previous synchronous helper', () => {
  const legacyPatched = patchRNFBMessagingModuleSource(
    rnfbMessagingModule,
  ).replace(
    /static BOOL RNFBMessagingIsRegisteredForRemoteNotifications\(\)[\s\S]*?(?=@implementation RNFBMessagingModule)/,
    legacyPatchedHelpers,
  );

  const patched = patchRNFBMessagingModuleSource(legacyPatched);

  assert.match(
    patched,
    /return \[FIRMessaging messaging\]\.APNSToken != nil;/,
  );
  assert.doesNotMatch(patched, /dispatch_sync\(/);
  assert.equal(patchRNFBMessagingModuleSource(patched), patched);
});

test('patchRNFBMessagingModuleSource fails loudly when RNFB signatures drift', () => {
  assert.throws(
    () => patchRNFBMessagingModuleSource('@implementation RNFBMessagingModule'),
    /expected isRegisteredForRemoteNotifications call sites/,
  );

  assert.throws(
    () =>
      patchRNFBMessagingModuleSource(
        rnfbMessagingModule.replace(
          '[[UIApplication sharedApplication] unregisterForRemoteNotifications];',
          'UIApplication.unregisterForRemoteNotifications();',
        ),
      ),
    /expected unregisterForRemoteNotifications call site/,
  );
});
