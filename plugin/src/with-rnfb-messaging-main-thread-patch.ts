import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ConfigPlugin,
  withDangerousMod,
} from 'expo/config-plugins';

const RNFB_MESSAGING_MODULE_RELATIVE_PATH = path.join(
  'node_modules',
  '@react-native-firebase',
  'messaging',
  'ios',
  'RNFBMessaging',
  'RNFBMessagingModule.mm',
);

const RNFB_MESSAGING_PACKAGE_JSON_RELATIVE_PATH = path.join(
  'node_modules',
  '@react-native-firebase',
  'messaging',
  'package.json',
);

const SUPPORTED_RNFB_MESSAGING_VERSION = '>=26.3.3 <27.0.0';
const IMPLEMENTATION_ANCHOR = '@implementation RNFBMessagingModule';
const REGISTERED_HELPER_NAME =
  'RNFBMessagingIsRegisteredForRemoteNotifications';
const UNREGISTER_HELPER_NAME =
  'RNFBMessagingUnregisterForRemoteNotifications';

const REGISTERED_HELPER = `static BOOL ${REGISTERED_HELPER_NAME}() {
#if TARGET_IPHONE_SIMULATOR
  return NO;
#else
  return [FIRMessaging messaging].APNSToken != nil;
#endif
}

static void ${UNREGISTER_HELPER_NAME}() {
  if ([NSThread isMainThread]) {
    [[UIApplication sharedApplication] unregisterForRemoteNotifications];
  } else {
    dispatch_async(dispatch_get_main_queue(), ^{
      [[UIApplication sharedApplication] unregisterForRemoteNotifications];
    });
  }
}

`;

const LEGACY_REGISTERED_HELPER = `static BOOL ${REGISTERED_HELPER_NAME}() {
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

static void ${UNREGISTER_HELPER_NAME}() {
  if ([NSThread isMainThread]) {
    [[UIApplication sharedApplication] unregisterForRemoteNotifications];
  } else {
    dispatch_sync(dispatch_get_main_queue(), ^{
      [[UIApplication sharedApplication] unregisterForRemoteNotifications];
    });
  }
}

`;

const REGISTERED_CALL_PATTERNS = [
  '[[UIApplication sharedApplication] isRegisteredForRemoteNotifications]',
  '[UIApplication sharedApplication].isRegisteredForRemoteNotifications',
] as const;

const UNREGISTER_CALL =
  '[[UIApplication sharedApplication] unregisterForRemoteNotifications];';

const withRNFBMessagingMainThreadPatch: ConfigPlugin = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const projectRoot = config.modRequest.projectRoot;

      await assertSupportedRNFBMessagingVersion(projectRoot);

      const filePath = path.join(
        projectRoot,
        RNFB_MESSAGING_MODULE_RELATIVE_PATH,
      );
      const source = await fs.readFile(filePath, 'utf8');
      const patchedSource = patchRNFBMessagingModuleSource(source);

      if (patchedSource !== source) {
        await fs.writeFile(filePath, patchedSource);
      }

      return config;
    },
  ]);
};

async function assertSupportedRNFBMessagingVersion(
  projectRoot: string,
): Promise<void> {
  const packageJsonPath = path.join(
    projectRoot,
    RNFB_MESSAGING_PACKAGE_JSON_RELATIVE_PATH,
  );
  let packageJson: { version?: unknown };

  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `[@fishonfire/bubbles-expo] Unable to read @react-native-firebase/messaging package.json before patching RNFBMessagingModule.mm: ${formatError(error)}`,
    );
  }

  if (
    typeof packageJson.version !== 'string' ||
    !isSupportedRNFBMessagingVersion(packageJson.version)
  ) {
    throw new Error(
      `[@fishonfire/bubbles-expo] Unsupported @react-native-firebase/messaging version "${String(
        packageJson.version,
      )}" for the iOS main-thread patch. Expected ${SUPPORTED_RNFB_MESSAGING_VERSION}. Re-check RNFBMessagingModule.mm before widening this guard.`,
    );
  }
}

export function isSupportedRNFBMessagingVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    return false;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (major !== 26) {
    return false;
  }

  if (minor < 3) {
    return false;
  }

  return minor > 3 || patch >= 3;
}

export function patchRNFBMessagingModuleSource(source: string): string {
  const hasRegisteredHelper = source.includes(REGISTERED_HELPER_NAME);
  const hasUnregisterHelper = source.includes(UNREGISTER_HELPER_NAME);

  if (hasRegisteredHelper || hasUnregisterHelper) {
    if (!hasRegisteredHelper || !hasUnregisterHelper) {
      throw new Error(
        '[@fishonfire/bubbles-expo] RNFBMessagingModule.mm contains a partial iOS main-thread patch. Remove the partial patch before running Expo prebuild again.',
      );
    }

    if (source.includes(REGISTERED_HELPER)) {
      return source;
    }

    if (source.includes(LEGACY_REGISTERED_HELPER)) {
      return source.replace(LEGACY_REGISTERED_HELPER, REGISTERED_HELPER);
    }

    throw new Error(
      '[@fishonfire/bubbles-expo] RNFBMessagingModule.mm contains an unrecognized existing iOS main-thread patch. Restore the original RNFirebase source before running Expo prebuild again.',
    );
  }

  if (!source.includes(IMPLEMENTATION_ANCHOR)) {
    throw new Error(
      `[@fishonfire/bubbles-expo] Unable to patch RNFBMessagingModule.mm: expected "${IMPLEMENTATION_ANCHOR}" was not found.`,
    );
  }

  const registeredCallCount = REGISTERED_CALL_PATTERNS.reduce(
    (count, pattern) => count + countOccurrences(source, pattern),
    0,
  );

  if (registeredCallCount === 0) {
    throw new Error(
      '[@fishonfire/bubbles-expo] Unable to patch RNFBMessagingModule.mm: expected isRegisteredForRemoteNotifications call sites were not found.',
    );
  }

  if (!source.includes(UNREGISTER_CALL)) {
    throw new Error(
      '[@fishonfire/bubbles-expo] Unable to patch RNFBMessagingModule.mm: expected unregisterForRemoteNotifications call site was not found.',
    );
  }

  let nextSource = source;
  for (const pattern of REGISTERED_CALL_PATTERNS) {
    nextSource = replaceAllLiteral(
      nextSource,
      pattern,
      `${REGISTERED_HELPER_NAME}()`,
    );
  }

  nextSource = replaceAllLiteral(
    nextSource,
    UNREGISTER_CALL,
    `${UNREGISTER_HELPER_NAME}();`,
  );

  return nextSource.replace(
    IMPLEMENTATION_ANCHOR,
    `${REGISTERED_HELPER}${IMPLEMENTATION_ANCHOR}`,
  );
}

function countOccurrences(source: string, pattern: string): number {
  return source.split(pattern).length - 1;
}

function replaceAllLiteral(
  source: string,
  pattern: string,
  replacement: string,
): string {
  return source.split(pattern).join(replacement);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default withRNFBMessagingMainThreadPatch;
