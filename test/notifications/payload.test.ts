import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { Notification } from 'expo-notifications'

import {
  getBubblesNotificationDataFromNotification,
  normalizeBubblesNotificationPayload,
  type BubblesNotificationDataContract,
  type BubblesVisibleNotificationPayloadContract
} from '../../src/notifications/payload.ts'

const NOTIFICATION_ID = 'notification-123'
const CAMPAIGN_ID = 'campaign-789'

function notificationWithData (data: unknown, trigger: unknown = null): Notification {
  return { request: { content: { data }, trigger } } as Notification
}

test.each([null, undefined, {}, { body: 'Message text' }])(
  'extracts flat iOS remote fields when content.data lacks an identifier: %j',
  (data) => {
    const remotePayload = {
      aps: { alert: { title: 'Title', body: 'Body' } },
      notification_id: 123,
      url: '/inbox',
      body: 'Message text'
    }
    const extracted = getBubblesNotificationDataFromNotification(
      notificationWithData(data, { type: 'push', payload: remotePayload })
    )

    assert.deepEqual(extracted, remotePayload)
    assert.equal(normalizeBubblesNotificationPayload(extracted).notificationId, '123')
    assert.equal(normalizeBubblesNotificationPayload(extracted).url, '/inbox')
  }
)

test('prefers existing content.data over conflicting remote payload fields', () => {
  const data = { notification_id: NOTIFICATION_ID, url: '/local' }

  assert.deepEqual(getBubblesNotificationDataFromNotification(notificationWithData(data, {
    type: 'push',
    payload: { notification_id: 'other-id', url: '/remote' }
  })), data)
  assert.deepEqual(getBubblesNotificationDataFromNotification(notificationWithData(data)), data)
})

test.each([undefined, null, [], 'invalid', {}, { notification_id: ' ' }])(
  'preserves content.data when the push payload has no valid identifier: %j',
  (payload) => {
    const data = { url: '/existing' }

    assert.deepEqual(getBubblesNotificationDataFromNotification(
      notificationWithData(data, { type: 'push', payload })
    ), data)
  }
)

test('does not extract a remote payload from a local notification trigger', () => {
  assert.deepEqual(getBubblesNotificationDataFromNotification(notificationWithData(null, {
    type: 'timeInterval',
    payload: { notification_id: NOTIFICATION_ID }
  })), {})
})

test('normalizes the required notification_id and optional sender fields', () => {
  const payload = normalizeBubblesNotificationPayload({
    notification_id: NOTIFICATION_ID,
    message_title: 'Title',
    body: 'Body',
    url: '/inbox',
    source: 'broadcast',
    message_id: 456,
    campaign_id: CAMPAIGN_ID
  })

  assert.deepEqual(payload, {
    data: {
      notification_id: NOTIFICATION_ID,
      message_title: 'Title',
      body: 'Body',
      url: '/inbox',
      source: 'broadcast',
      message_id: 456,
      campaign_id: CAMPAIGN_ID
    },
    notificationId: NOTIFICATION_ID,
    messageTitle: 'Title',
    body: 'Body',
    source: 'broadcast',
    messageId: '456',
    campaignId: CAMPAIGN_ID,
    url: '/inbox'
  })
})

test('does not accept legacy id as the notification identifier', () => {
  const payload = normalizeBubblesNotificationPayload({
    id: 'legacy-id',
    url: '/legacy'
  })

  assert.equal(payload.notificationId, null)
  assert.equal(payload.url, '/legacy')
})

test('keeps contract types explicit for backend sender payloads', () => {
  const data = {
    notification_id: NOTIFICATION_ID,
    type: 'message',
    url: '/messages/1',
    source: 'system',
    message_id: 'message-1',
    resource_type: 'thread'
  } satisfies BubblesNotificationDataContract

  const visiblePayload = {
    notification: {
      title: 'New message',
      body: 'Open the app to reply.'
    },
    data
  } satisfies BubblesVisibleNotificationPayloadContract

  assert.equal(visiblePayload.data.notification_id, NOTIFICATION_ID)
})
