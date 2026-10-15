import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const DEFAULT_CHANNEL_ID = 'runtime-default'
const DEFAULT_CHANNEL_NAME = 'Runtime Default'

const platformState = {
  OS: 'android'
}
const runtimeConfigState = {
  defaultChannelId: DEFAULT_CHANNEL_ID,
  defaultChannelName: DEFAULT_CHANNEL_NAME,
  androidChannelImportance: 'high'
}
const setNotificationChannelCalls: {
  channelId: string;
  channel: Record<string, unknown>;
}[] = []

vi.doMock('expo-notifications', () => ({
  AndroidImportance: {
    MIN: 'MIN',
    LOW: 'LOW',
    DEFAULT: 'DEFAULT',
    HIGH: 'HIGH',
    MAX: 'MAX'
  },
  setNotificationChannelAsync: async (
    channelId: string,
    channel: Record<string, unknown>
  ) => {
    setNotificationChannelCalls.push({ channelId, channel })

    return {
      id: channelId,
      ...channel
    }
  }
}))

vi.doMock('react-native', () => ({
  Platform: platformState
}))

vi.doMock('../../src/config/runtime-config.ts', () => ({
  getBubblesNotificationsRuntimeConfig: () => runtimeConfigState
}))

const {
  ensureDefaultNotificationChannel,
  getAndroidNotificationChannelImportance,
  getDefaultNotificationChannelConfig
} = await import('../../src/runtime/channels.ts')

beforeEach(() => {
  platformState.OS = 'android'
  runtimeConfigState.defaultChannelId = DEFAULT_CHANNEL_ID
  runtimeConfigState.defaultChannelName = DEFAULT_CHANNEL_NAME
  runtimeConfigState.androidChannelImportance = 'high'
  setNotificationChannelCalls.length = 0
})

test('getAndroidNotificationChannelImportance maps every supported runtime value to the Expo Android importance enum', () => {
  assert.equal(getAndroidNotificationChannelImportance('min'), 'MIN')
  assert.equal(getAndroidNotificationChannelImportance('low'), 'LOW')
  assert.equal(
    getAndroidNotificationChannelImportance('default'),
    'DEFAULT'
  )
  assert.equal(getAndroidNotificationChannelImportance('high'), 'HIGH')
  assert.equal(getAndroidNotificationChannelImportance('max'), 'MAX')
})

test('ensureDefaultNotificationChannel returns null on non-Android platforms', async () => {
  platformState.OS = 'ios'

  const result = await ensureDefaultNotificationChannel()

  assert.equal(result, null)
  assert.deepEqual(setNotificationChannelCalls, [])
})

test('ensureDefaultNotificationChannel uses the runtime defaults when no overrides are provided', async () => {
  const result = await ensureDefaultNotificationChannel()

  assert.deepEqual(setNotificationChannelCalls, [
    {
      channelId: DEFAULT_CHANNEL_ID,
      channel: {
        name: DEFAULT_CHANNEL_NAME,
        importance: 'HIGH'
      }
    }
  ])
  assert.deepEqual(result, {
    id: DEFAULT_CHANNEL_ID,
    name: DEFAULT_CHANNEL_NAME,
    importance: 'HIGH'
  })
})

test('getDefaultNotificationChannelConfig exposes the configured channel for backend payloads', () => {
  assert.deepEqual(getDefaultNotificationChannelConfig(), {
    channelId: DEFAULT_CHANNEL_ID,
    channelName: DEFAULT_CHANNEL_NAME,
    importance: 'high'
  })
})

test('ensureDefaultNotificationChannel trims explicit channel overrides before applying them', async () => {
  await ensureDefaultNotificationChannel({
    channelId: ' messages ',
    channelName: ' Messages ',
    importance: 'max'
  })

  assert.deepEqual(setNotificationChannelCalls, [
    {
      channelId: 'messages',
      channel: {
        name: 'Messages',
        importance: 'MAX'
      }
    }
  ])
})

test('ensureDefaultNotificationChannel rejects empty override values with the current error text', async () => {
  await assert.rejects(
    () =>
      ensureDefaultNotificationChannel({
        channelId: 'messages',
        channelName: '   '
      }),
    /"channelName" must not be empty\./
  )

  assert.deepEqual(setNotificationChannelCalls, [])
})
