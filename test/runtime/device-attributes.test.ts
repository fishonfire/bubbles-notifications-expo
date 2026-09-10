import assert from 'node:assert/strict';
import { test, vi } from 'vitest';

vi.doMock('expo-application', () => ({
  applicationId: 'com.example.app',
  applicationName: 'Example',
  nativeApplicationVersion: '1.2.3',
  nativeBuildVersion: '123',
}));

vi.doMock('expo-device', () => ({
  DeviceType: {
    UNKNOWN: 0,
    PHONE: 1,
    TABLET: 2,
    DESKTOP: 3,
    TV: 4,
  },
  manufacturer: 'Apple',
  brand: 'Apple',
  modelName: 'iPhone 15',
  modelId: null,
  deviceName: "Menno's iPhone",
  deviceType: 1,
  totalMemory: 8589934592,
  osName: 'iOS',
  osVersion: '18.0',
  osBuildId: '22A3354',
  platformApiLevel: null,
  getDeviceTypeAsync: async () => 2,
}));

const { collectBubblesDeviceAttributes } = await import(
  '../../src/runtime/device-attributes.ts'
);

test('collectBubblesDeviceAttributes groups Expo-managed device, OS, and app attributes', async () => {
  await assert.deepEqual(await collectBubblesDeviceAttributes(), {
    device: {
      manufacturer: 'Apple',
      brand: 'Apple',
      modelName: 'iPhone 15',
      deviceName: "Menno's iPhone",
      deviceType: 'phone',
      totalMemory: 8589934592,
    },
    os: {
      name: 'iOS',
      version: '18.0',
      buildId: '22A3354',
    },
    app: {
      applicationId: 'com.example.app',
      applicationName: 'Example',
      nativeApplicationVersion: '1.2.3',
      nativeBuildVersion: '123',
    },
  });
});
