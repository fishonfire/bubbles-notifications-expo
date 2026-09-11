import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';

const deviceClientCalls = {
  constructor: [] as Array<Record<string, unknown>>,
  create: [] as Array<{
    payload: Record<string, unknown>;
    requestOptions: unknown;
  }>,
  update: [] as Array<{
    deviceId: string;
    payload: Record<string, unknown>;
    requestOptions: unknown;
  }>,
  attributes: [] as Array<{
    deviceId: string;
    attributes: Record<string, unknown>;
    requestOptions: unknown;
  }>,
};

class MockDeviceClient {
  constructor(options: Record<string, unknown>) {
    deviceClientCalls.constructor.push(options);
  }

  async createDevice(
    payload: Record<string, unknown>,
    requestOptions: unknown,
  ) {
    deviceClientCalls.create.push({ payload, requestOptions });
    return { id: 'created-device' };
  }

  async updateDevice(
    deviceId: string,
    payload: Record<string, unknown>,
    requestOptions: unknown,
  ) {
    deviceClientCalls.update.push({
      deviceId,
      payload,
      requestOptions,
    });
    return { id: deviceId };
  }

  async updateDeviceAttributes(
    deviceId: string,
    attributes: Record<string, unknown>,
    requestOptions: unknown,
  ) {
    deviceClientCalls.attributes.push({
      deviceId,
      attributes,
      requestOptions,
    });
    return { id: deviceId };
  }
}

vi.doMock('@fishonfire/bubbles-js', () => ({
  DeviceClient: MockDeviceClient,
  getLocaleAndTimeZone: () => ({
    locale: 'en-US',
    timeZone: 'UTC',
  }),
}));

const {
  BubblesAppAuthenticationError,
  createBubblesDeviceClient,
  syncBubblesDevice,
  updateBubblesDeviceAttributes,
} = await import('../../src/api/device-client.ts');

beforeEach(() => {
  deviceClientCalls.constructor.length = 0;
  deviceClientCalls.create.length = 0;
  deviceClientCalls.update.length = 0;
  deviceClientCalls.attributes.length = 0;
});

test('createBubblesDeviceClient trims the baseUrl before constructing the client', () => {
  createBubblesDeviceClient({
    baseUrl: ' https://api.example.com ',
    appKey: ' app-key-1 ',
  } as never);

  assert.deepEqual(deviceClientCalls.constructor, [
    {
      baseUrl: 'https://api.example.com',
      defaultHeaders: {
        'X-App-Key': 'app-key-1',
      },
    },
  ]);
});

test('syncBubblesDevice normalizes the update-path deviceId before delegating', async () => {
  const result = await syncBubblesDevice({
    apiBaseUrl: ' https://api.example.com ',
    appKey: ' app-key-1 ',
    deviceId: ' device-1 ',
    appId: 'app-1',
    userId: ' user-1 ',
    aliasing: [],
    platform: 'android',
    pushToken: ' token-1 ',
    notificationsEnabled: true,
    localeAndTimeZone: {
      locale: ' en-US ',
      timeZone: ' UTC ',
    },
  });

  assert.deepEqual(deviceClientCalls.constructor, [
    {
      baseUrl: 'https://api.example.com',
      defaultHeaders: {
        'X-App-Key': 'app-key-1',
      },
    },
  ]);
  assert.deepEqual(deviceClientCalls.update, [
    {
      deviceId: 'device-1',
      payload: {
        user_id: 'user-1',
        aliasing: [],
        platform: 'android',
        push_token: 'token-1',
        locale: 'en-US',
        timezone: 'UTC',
        notifications_enabled: true,
      },
      requestOptions: {
        headers: {
          'X-App-Key': 'app-key-1',
        },
      },
    },
  ]);
  assert.deepEqual(result, {
    action: 'updated',
    deviceId: 'device-1',
    response: {
      id: 'device-1',
    },
  });
});

test('syncBubblesDevice preserves request headers while applying X-App-Key', async () => {
  await syncBubblesDevice({
    apiBaseUrl: 'https://api.example.com',
    appKey: 'app-key-2',
    deviceId: null,
    appId: 'app-1',
    userId: 'user-1',
    aliasing: [],
    platform: 'ios',
    pushToken: 'token-1',
    notificationsEnabled: true,
    createRequestOptions: {
      headers: {
        'X-Custom': 'custom',
      },
    },
  });

  assert.deepEqual(deviceClientCalls.create[0]?.requestOptions, {
    headers: {
      'X-Custom': 'custom',
      'X-App-Key': 'app-key-2',
    },
  });
});

test('updateBubblesDeviceAttributes posts normalized attributes with X-App-Key', async () => {
  const result = await updateBubblesDeviceAttributes({
    apiBaseUrl: ' https://api.example.com ',
    appKey: ' app-key-3 ',
    deviceId: ' device-3 ',
    attributes: {
      device: {
        manufacturer: 'Apple',
        deviceType: 'phone',
      },
      os: {
        version: '18.0',
      },
      app: {
        nativeApplicationVersion: '1.2.3',
        flags: [true, null, { rollout: 25 }],
      },
    },
    requestOptions: {
      headers: {
        'X-Custom': 'custom',
      },
    },
  });

  assert.deepEqual(deviceClientCalls.attributes, [
    {
      deviceId: 'device-3',
      attributes: {
        device: {
          manufacturer: 'Apple',
          deviceType: 'phone',
        },
        os: {
          version: '18.0',
        },
        app: {
          nativeApplicationVersion: '1.2.3',
          flags: [true, null, { rollout: 25 }],
        },
      },
      requestOptions: {
        headers: {
          'X-Custom': 'custom',
          'X-App-Key': 'app-key-3',
        },
      },
    },
  ]);
  assert.deepEqual(result, {
    id: 'device-3',
  });
});

test('updateBubblesDeviceAttributes rejects non-object attributes', async () => {
  await assert.rejects(
    () =>
      updateBubblesDeviceAttributes({
        apiBaseUrl: 'https://api.example.com',
        appKey: 'app-key-1',
        deviceId: 'device-1',
        attributes: [] as never,
      }),
    /"attributes" must be an object\./,
  );
});

test('updateBubblesDeviceAttributes rejects nested non-JSON-compatible attributes', async () => {
  const cyclicAttributes: Record<string, unknown> = {};
  cyclicAttributes.self = cyclicAttributes;

  const symbolKeyedAttributes = {
    visible: 'value',
    [Symbol('hidden')]: 'hidden',
  };

  const invalidAttributes = [
    {
      attributes: { plan: undefined },
      message: /attributes\.plan must be a JSON-compatible value\./,
    },
    {
      attributes: { score: Number.NaN },
      message: /attributes\.score must be a finite number\./,
    },
    {
      attributes: { score: Infinity },
      message: /attributes\.score must be a finite number\./,
    },
    {
      attributes: { count: 1n },
      message: /attributes\.count must be a JSON-compatible value\./,
    },
    {
      attributes: { compute: () => 'pro' },
      message: /attributes\.compute must be a JSON-compatible value\./,
    },
    {
      attributes: { createdAt: new Date() },
      message: /attributes\.createdAt must be a JSON-compatible object\./,
    },
    {
      attributes: { nested: [undefined] },
      message: /attributes\.nested\[0\] must be a JSON-compatible value\./,
    },
    {
      attributes: symbolKeyedAttributes,
      message: /attributes must not contain symbol keys\./,
    },
    {
      attributes: cyclicAttributes,
      message: /attributes\.self must not contain cycles\./,
    },
  ];

  for (const { attributes, message } of invalidAttributes) {
    await assert.rejects(
      () =>
        updateBubblesDeviceAttributes({
          apiBaseUrl: 'https://api.example.com',
          appKey: 'app-key-1',
          deviceId: 'device-1',
          attributes: attributes as never,
        }),
      message,
    );
  }

  assert.equal(deviceClientCalls.attributes.length, 0);
});

test('syncBubblesDevice maps invalid app key responses to an app authentication error', async () => {
  const client = {
    updateDevice: async () => {
      throw Object.assign(new Error('Unauthorized'), {
        status: 401,
        body: {
          error: 'invalid app key for app',
        },
      });
    },
  } as never;

  await assert.rejects(
    () =>
      syncBubblesDevice({
        client,
        appKey: 'app-key-1',
        deviceId: 'device-1',
        appId: 'app-1',
        userId: 'user-1',
        aliasing: [],
        platform: 'android',
        pushToken: 'token-1',
        notificationsEnabled: true,
      }),
    BubblesAppAuthenticationError,
  );
});
