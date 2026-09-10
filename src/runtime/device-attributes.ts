import * as Application from 'expo-application';
import * as Device from 'expo-device';

import type {
  BubblesDeviceAttributeValue,
  BubblesDeviceAttributes,
} from '../api/device-client';

type AttributeSection = Record<string, BubblesDeviceAttributeValue | undefined>;

function compactAttributes(
  attributes: AttributeSection,
): Record<string, BubblesDeviceAttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [
      string,
      BubblesDeviceAttributeValue,
    ] => entry[1] !== null && entry[1] !== undefined),
  );
}

function addSection(
  attributes: BubblesDeviceAttributes,
  name: string,
  section: AttributeSection,
): void {
  const compactedSection = compactAttributes(section);

  if (Object.keys(compactedSection).length > 0) {
    attributes[name] = compactedSection;
  }
}

function getDeviceTypeName(
  deviceType: Device.DeviceType | null | undefined,
): string | undefined {
  switch (deviceType) {
    case Device.DeviceType.PHONE:
      return 'phone';
    case Device.DeviceType.TABLET:
      return 'tablet';
    case Device.DeviceType.DESKTOP:
      return 'desktop';
    case Device.DeviceType.TV:
      return 'tv';
    case Device.DeviceType.UNKNOWN:
      return 'unknown';
    default:
      return undefined;
  }
}

async function getDeviceType(): Promise<Device.DeviceType | null> {
  if (Device.deviceType !== null && Device.deviceType !== undefined) {
    return Device.deviceType;
  }

  try {
    return await Device.getDeviceTypeAsync();
  } catch {
    return null;
  }
}

export async function collectBubblesDeviceAttributes(): Promise<BubblesDeviceAttributes> {
  const attributes: BubblesDeviceAttributes = {};
  const deviceType = await getDeviceType();

  addSection(attributes, 'device', {
    manufacturer: Device.manufacturer,
    brand: Device.brand,
    modelName: Device.modelName,
    modelId: typeof Device.modelId === 'string' ? Device.modelId : undefined,
    deviceName: Device.deviceName,
    deviceType: getDeviceTypeName(deviceType),
    totalMemory: Device.totalMemory,
  });

  addSection(attributes, 'os', {
    name: Device.osName,
    version: Device.osVersion,
    buildId: Device.osBuildId,
    platformApiLevel: Device.platformApiLevel,
  });

  addSection(attributes, 'app', {
    applicationId: Application.applicationId,
    applicationName: Application.applicationName,
    nativeApplicationVersion: Application.nativeApplicationVersion,
    nativeBuildVersion: Application.nativeBuildVersion,
  });

  return attributes;
}
