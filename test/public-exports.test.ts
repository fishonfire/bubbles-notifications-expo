import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { test } from 'vitest';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');

function getModuleExports(relativePath: string): string[] {
  const filePath = resolve(PROJECT_ROOT, relativePath);
  const program = ts.createProgram([filePath], {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
  });
  const sourceFile = program.getSourceFile(filePath);

  assert.ok(sourceFile);

  const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(sourceFile);

  assert.ok(moduleSymbol);

  return program
    .getTypeChecker()
    .getExportsOfModule(moduleSymbol)
    .map(({ name }) => name)
    .sort();
}

test('package root exposes only the supported application API', () => {
  assert.deepEqual(getModuleExports('src/index.ts'), [
    'AndroidChannelImportance',
    'BubblesDeviceAttributeValue',
    'BubblesDeviceAttributes',
    'BubblesForegroundNotificationPayloadContract',
    'BubblesNotificationDataContract',
    'BubblesNotificationResponseEvent',
    'BubblesNotificationsContextValue',
    'BubblesNotificationsProvider',
    'BubblesNotificationsProviderProps',
    'BubblesSilentNotificationPayloadContract',
    'BubblesVisibleNotificationPayloadContract',
    'DefaultNotificationChannelConfig',
    'EnsureDefaultNotificationChannelOptions',
    'ForegroundPresentationOptions',
    'GetDeviceTokenOptions',
    'GetNotificationPermissionsOptions',
    'PermissionRequestOptions',
    'RegisterDevice',
    'RegisterDeviceOptions',
    'ensureDefaultNotificationChannel',
    'ensureNotificationPermissions',
    'getFCMToken',
    'getNotificationPermissions',
    'isNotificationPermissionGranted',
    'registerBubblesBackgroundHandlers',
    'useBubblesNotifications',
  ]);
});

test('compatibility subpath contains only demonstrated legacy APIs', () => {
  assert.deepEqual(getModuleExports('src/compat.ts'), [
    'UpdateBubblesDeviceAttributesOptions',
    'readStoredApiBaseUrl',
    'readStoredAppKey',
    'readStoredDeviceId',
    'updateBubblesDeviceAttributes',
  ]);

  const packageJson = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    scripts: Record<string, string>;
  };

  assert.deepEqual(Object.keys(packageJson.exports).sort(), [
    '.',
    './compat',
    './register-task',
  ]);
  assert.match(packageJson.scripts['build:runtime'], /src\/compat\.ts/);
});
