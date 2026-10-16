import assert from 'node:assert/strict'
import { test } from 'vitest'

import {
  normalizeBubblesNotificationPayload,
  type BubblesNotificationDataContract,
  type BubblesVisibleNotificationPayloadContract
} from '../../src/notifications/payload.ts'

const NOTIFICATION_ID = 'notification-123'
const CAMPAIGN_ID = 'campaign-789'

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
