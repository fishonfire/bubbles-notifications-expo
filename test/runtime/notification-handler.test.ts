import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

import type { NotificationHandler } from 'expo-notifications'

const installedHandlers: (NotificationHandler | null)[] = []

vi.doMock('expo-notifications', () => ({
  setNotificationHandler (handler: NotificationHandler | null) {
    installedHandlers.push(handler)
  }
}))

beforeEach(() => {
  vi.resetModules()
  installedHandlers.length = 0
})

test('notification handler installs once and remains installed after owner cleanup', async () => {
  const {
    acquireBubblesNotificationHandler,
    updateBubblesNotificationHandler
  } = await import('../../src/runtime/notification-handler.ts')
  const firstOwner = {}
  const releaseFirstOwner = acquireBubblesNotificationHandler(firstOwner)

  updateBubblesNotificationHandler(firstOwner, {
    shouldPlaySound: true
  })

  assert.equal(installedHandlers.length, 1)
  const installedHandler = installedHandlers[0]

  assert.ok(installedHandler)
  assert.deepEqual(
    await installedHandler.handleNotification(undefined as never),
    {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false
    }
  )

  releaseFirstOwner()
  assert.equal(installedHandlers.length, 1)

  const secondOwner = {}
  const releaseSecondOwner = acquireBubblesNotificationHandler(secondOwner)

  updateBubblesNotificationHandler(secondOwner, {
    shouldShowBanner: false
  })

  assert.equal(installedHandlers.length, 1)
  assert.deepEqual(
    await installedHandler.handleNotification(undefined as never),
    {
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false
    }
  )

  releaseSecondOwner()
})

test('notification handler hands over options and ignores stale updates and cleanup', async () => {
  const { acquireBubblesNotificationHandler, updateBubblesNotificationHandler } = await import(
    '../../src/runtime/notification-handler.ts'
  )
  const Notifications = await import('expo-notifications')
  const firstOwner = {}
  const releaseOwner = acquireBubblesNotificationHandler(firstOwner)
  const nextOwner = {}
  const releaseNextOwner = acquireBubblesNotificationHandler(nextOwner)

  updateBubblesNotificationHandler(nextOwner, { shouldPlaySound: true })
  updateBubblesNotificationHandler(firstOwner, { shouldPlaySound: false })
  releaseOwner()
  assert.equal(installedHandlers.length, 1)
  assert.equal((await installedHandlers[0]?.handleNotification(undefined as never))?.shouldPlaySound, true)

  const unrelatedHandler = {
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false
    })
  } satisfies NotificationHandler

  Notifications.setNotificationHandler(unrelatedHandler)
  releaseNextOwner()
  assert.equal(installedHandlers.length, 2)
  assert.equal(
    installedHandlers[installedHandlers.length - 1],
    unrelatedHandler
  )
})

test('same-owner replay cannot release a newer notification handler lease', async () => {
  const { acquireBubblesNotificationHandler, updateBubblesNotificationHandler } = await import(
    '../../src/runtime/notification-handler.ts'
  )
  const owner = {}
  const releaseOld = acquireBubblesNotificationHandler(owner)
  const releaseNew = acquireBubblesNotificationHandler(owner)

  updateBubblesNotificationHandler(owner, { shouldShowBanner: false })
  releaseOld()
  assert.equal((await installedHandlers[0]?.handleNotification(undefined as never))?.shouldShowBanner, false)
  releaseNew()
})
