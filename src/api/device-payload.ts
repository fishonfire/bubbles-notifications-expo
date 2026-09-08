import {
  getLocaleAndTimeZone,
  type LocaleAndTimeZone,
} from '@fishonfire/bubbles-js';
import {
  getRequiredNonEmptyString,
} from '../internal/validation';
import { failWithBubblesError } from '../internal/errors';

export type BubblesDevicePlatform = 'android' | 'ios';

export interface BuildBubblesDevicePayloadOptions {
  userId: string;
  aliasing?: string[] | null;
  platform: BubblesDevicePlatform;
  pushToken: string | null;
  fid?: string | null;
  appVersion?: string | null;
  notificationsEnabled: boolean;
  localeAndTimeZone?: LocaleAndTimeZone;
}

export interface BuildBubblesCreateDevicePayloadOptions
  extends BuildBubblesDevicePayloadOptions {
  appId: string | number;
}

export interface BubblesDevicePayload {
  user_id: string;
  aliasing: string[];
  platform: BubblesDevicePlatform;
  push_token: string | null;
  fid?: string | null;
  app_version?: string;
  locale: string;
  timezone?: string;
  notifications_enabled: boolean;
}

export interface BubblesCreateDevicePayload extends BubblesDevicePayload {
  app_id: string | number;
}

export type BubblesUpdateDevicePayload = BubblesDevicePayload;

function normalizeOptionalString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'string') {
    failWithBubblesError(`"${fieldName}" must be a string when present.`);
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeRequiredNullableString(
  value: unknown,
  fieldName: string,
): string | null {
  if (value === null) {
    return null;
  }

  if (value === undefined) {
    failWithBubblesError(
      `"${fieldName}" is required. Pass a push token string or null.`,
    );
  }

  return getRequiredNonEmptyString(value, fieldName);
}

function normalizeAppId(value: unknown): string | number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      failWithBubblesError('"appId" must be a finite number.');
    }

    return value;
  }

  if (typeof value === 'string') {
    return getRequiredNonEmptyString(value, 'appId');
  }

  failWithBubblesError('"appId" must be a string or number.');
}

function normalizePlatform(value: unknown): BubblesDevicePlatform {
  if (value === 'android' || value === 'ios') {
    return value;
  }

  failWithBubblesError('"platform" must be either "android" or "ios".');
}

function normalizeAliasing(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    failWithBubblesError('"aliasing" must be an array of strings when present.');
  }

  return value
    .map((entry, index) =>
      normalizeOptionalString(entry, `aliasing[${index}]`),
    )
    .filter((entry): entry is string => entry !== null);
}

function normalizeNotificationsEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    failWithBubblesError('"notificationsEnabled" must be a boolean.');
  }

  return value;
}

function resolveLocaleAndTimeZone(
  input?: LocaleAndTimeZone,
): { locale: string; timeZone: string | null } {
  const resolved = input ?? getLocaleAndTimeZone();

  return {
    locale: getRequiredNonEmptyString(resolved.locale, 'locale'),
    timeZone: normalizeOptionalString(resolved.timeZone, 'timeZone'),
  };
}

function buildBaseDevicePayload(
  options: BuildBubblesDevicePayloadOptions,
): BubblesDevicePayload {
  const { locale, timeZone } = resolveLocaleAndTimeZone(
    options.localeAndTimeZone,
  );

  const payload: BubblesDevicePayload = {
    user_id: getRequiredNonEmptyString(options.userId, 'userId'),
    aliasing: normalizeAliasing(options.aliasing),
    platform: normalizePlatform(options.platform),
    push_token: normalizeRequiredNullableString(options.pushToken, 'pushToken'),
    locale,
    notifications_enabled: normalizeNotificationsEnabled(
      options.notificationsEnabled,
    ),
  };

  if ('fid' in options) {
    payload.fid = normalizeOptionalString(options.fid, 'fid');
  }

  const appVersion = normalizeOptionalString(options.appVersion, 'appVersion');
  if (appVersion) {
    payload.app_version = appVersion;
  }

  if (timeZone) {
    payload.timezone = timeZone;
  }

  return payload;
}

export function buildCreateDevicePayload(
  options: BuildBubblesCreateDevicePayloadOptions,
): BubblesCreateDevicePayload {
  return {
    app_id: normalizeAppId(options.appId),
    ...buildBaseDevicePayload(options),
  };
}

export function buildUpdateDevicePayload(
  options: BuildBubblesDevicePayloadOptions,
): BubblesUpdateDevicePayload {
  return buildBaseDevicePayload(options);
}
