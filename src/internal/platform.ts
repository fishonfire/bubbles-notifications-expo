import { failWithBubblesError } from './errors';

export type SupportedPlatform = 'android' | 'ios';

function isSupportedPlatform(
  value: string,
): value is SupportedPlatform {
  return value === 'android' || value === 'ios';
}

export function assertSupportedPlatform(
  value: string,
): asserts value is SupportedPlatform {
  if (isSupportedPlatform(value)) {
    return;
  }

  failWithBubblesError(
    `Unsupported platform: ${value}. This package only supports iOS and Android.`,
  );
}

export function getSupportedPlatform(
  value: string,
): SupportedPlatform {
  assertSupportedPlatform(value);
  return value;
}
