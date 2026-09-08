import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildCreateDevicePayload,
  buildUpdateDevicePayload,
} from '../../src/api/device-payload';

test('buildCreateDevicePayload normalizes values and includes create-only fields', () => {
  const payload = buildCreateDevicePayload({
    appId: ' app-123 ',
    userId: ' user-123 ',
    aliasing: [' alpha ', ' ', 'beta'],
    platform: 'android',
    pushToken: ' token-123 ',
    fid: ' fid-123 ',
    appVersion: ' 1.2.3 ',
    notificationsEnabled: true,
    localeAndTimeZone: {
      locale: ' en-US ',
      timeZone: ' Europe/Amsterdam ',
    },
  });

  assert.deepEqual(payload, {
    app_id: 'app-123',
    user_id: 'user-123',
    aliasing: ['alpha', 'beta'],
    platform: 'android',
    push_token: 'token-123',
    fid: 'fid-123',
    app_version: '1.2.3',
    locale: 'en-US',
    timezone: 'Europe/Amsterdam',
    notifications_enabled: true,
  });
});

test('buildUpdateDevicePayload omits create-only fields and optional blanks', () => {
  const payload = buildUpdateDevicePayload({
    userId: ' user-456 ',
    aliasing: [],
    platform: 'ios',
    pushToken: null,
    fid: null,
    appVersion: '   ',
    notificationsEnabled: false,
    localeAndTimeZone: {
      locale: ' nl-NL ',
      timeZone: '   ',
    },
  });

  assert.deepEqual(payload, {
    user_id: 'user-456',
    aliasing: [],
    platform: 'ios',
    push_token: null,
    fid: null,
    locale: 'nl-NL',
    notifications_enabled: false,
  });
});

test('buildCreateDevicePayload rejects non-finite numeric app ids', () => {
  assert.throws(
    () =>
      buildCreateDevicePayload({
        appId: Number.POSITIVE_INFINITY,
        userId: 'user-1',
        aliasing: [],
        platform: 'android',
        pushToken: 'token-1',
        notificationsEnabled: true,
        localeAndTimeZone: {
          locale: 'en-US',
          timeZone: 'UTC',
        },
      }),
    /"appId" must be a finite number\./,
  );
});

test('buildUpdateDevicePayload rejects an undefined push token input', () => {
  assert.throws(
    () =>
      buildUpdateDevicePayload({
        userId: 'user-1',
        aliasing: [],
        platform: 'android',
        pushToken: undefined as never,
        notificationsEnabled: true,
        localeAndTimeZone: {
          locale: 'en-US',
          timeZone: 'UTC',
        },
      }),
    /"pushToken" is required\. Pass a push token string or null\./,
  );
});
