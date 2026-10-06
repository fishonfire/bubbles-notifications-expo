import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, vi } from 'vitest';

import { normalizePluginConfig } from '../../plugin/src/config.ts';

type ModConfig = {
  android?: { package: string };
  modRequest: { projectRoot: string };
  modResults: {
    manifest: {
      $: Record<string, string>;
      application: Array<{
        $: Record<string, string>;
        'meta-data'?: Array<{ $: Record<string, string> }>;
        provider?: Array<{ $: Record<string, string> }>;
        service?: Array<{ $: Record<string, string> }>;
      }>;
    };
  };
};
let registrationMod!: (config: ModConfig) => Promise<ModConfig>;
let manifestMod!: (config: ModConfig) => ModConfig;

vi.doMock('expo/config-plugins', async importOriginal => ({
  ...await importOriginal<typeof import('expo/config-plugins')>(),
  withDangerousMod(config: unknown, [, mod]: [string, typeof registrationMod]) {
    registrationMod = mod;
    return config;
  },
  withAndroidManifest(config: unknown, mod: typeof manifestMod) {
    manifestMod = mod;
    return config;
  },
}));

const { default: withRegistration } = await import('../../plugin/src/with-firebase-messaging-registration.ts');
const { default: withManifest } = await import('../../plugin/src/with-firebase-messaging-manifest.ts');

function installMods(config: ModConfig, enabled: boolean) {
  const options = normalizePluginConfig({ enableFirebaseInstallationPushRegistration: enabled });
  withRegistration(config as never, options);
  withManifest(config as never, options);
}

test('disabling FID registration removes generated Android source and manifest entries', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bubbles-fid-cleanup-'));
  const config: ModConfig = {
    android: { package: 'com.demo.app' },
    modRequest: { projectRoot },
    modResults: {
      manifest: {
        $: {},
        application: [{
          $: { 'android:name': '.MainApplication' },
          provider: [{ $: { 'android:name': '.UnrelatedProvider' } }],
          service: [{ $: { 'android:name': '.UnrelatedService' } }],
        }],
      },
    },
  };
  const directory = path.join(projectRoot, 'android/app/src/main/java/com/demo/app');
  const registrar = path.join(directory, 'BubblesFirebaseMessagingRegistrar.java');

  try {
    installMods(config, true);
    await registrationMod(config);
    manifestMod(config);
    assert.match(await fs.readFile(registrar, 'utf8'), /getMethod\("register"\)/);
    const application = config.modResults.manifest.application[0];
    assert.equal(application.provider?.length, 2);
    assert.equal(application['meta-data']?.some(item => item.$['android:name'] === 'firebase_messaging_installation_id_enabled'), true);
    await fs.writeFile(path.join(directory, 'Unrelated.java'), 'keep');

    // Cleanup also handles an old package path and apps without a configured package.
    delete config.android;
    installMods(config, false);
    await registrationMod(config);
    manifestMod(config);
    assert.deepEqual(await fs.readdir(directory), ['Unrelated.java']);
    assert.equal(application['meta-data']?.some(item => item.$['android:name'] === 'firebase_messaging_installation_id_enabled'), false);
    assert.deepEqual(application.provider, [{ $: { 'android:name': '.UnrelatedProvider' } }]);
    assert.deepEqual(application.service, [{ $: { 'android:name': '.UnrelatedService' } }]);

    await registrationMod(config);
    manifestMod(config);
    assert.deepEqual(await fs.readdir(directory), ['Unrelated.java']);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('disabled registration tolerates projects without a native Android directory', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bubbles-fid-no-android-'));
  try {
    const config = { modRequest: { projectRoot } } as ModConfig;
    installMods(config, false);
    await registrationMod(config);
    assert.deepEqual(await fs.readdir(projectRoot), []);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
