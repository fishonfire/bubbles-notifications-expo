import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const configuration = { appId: 1, appKey: 'key', apiBaseUrl: 'https://example.test' }

beforeEach(() => vi.resetModules())

test('compatible handover revokes the old provider before stale cleanup and never restores it', async () => {
  const { acquireBubblesProviderOwnership, isCurrentBubblesProvider } = await import('../../src/runtime/provider-ownership')
  const first = {}
  const second = {}
  const revokeFirst = vi.fn(() => assert.equal(isCurrentBubblesProvider(first), false))
  const revokeSecond = vi.fn()
  const releaseFirst = acquireBubblesProviderOwnership(first, configuration, revokeFirst)
  const releaseSecond = acquireBubblesProviderOwnership(second, configuration, revokeSecond)

  assert.equal(revokeFirst.mock.calls.length, 1)
  releaseFirst()
  assert.equal(revokeSecond.mock.calls.length, 0)
  assert.equal(isCurrentBubblesProvider(second), true)
  releaseSecond()
  assert.equal(revokeSecond.mock.calls.length, 1)
  assert.equal(isCurrentBubblesProvider(first), false)
  const third = {}
  const releaseThird = acquireBubblesProviderOwnership(third, configuration, vi.fn())

  assert.equal(isCurrentBubblesProvider(third), true)
  releaseThird()
})

test('current cleanup before retired cleanup does not resurrect the retired owner', async () => {
  const { acquireBubblesProviderOwnership, isCurrentBubblesProvider } = await import('../../src/runtime/provider-ownership')
  const first = {}
  const second = {}
  const releaseFirst = acquireBubblesProviderOwnership(first, configuration, vi.fn())
  const releaseSecond = acquireBubblesProviderOwnership(second, configuration, vi.fn())

  releaseSecond()
  releaseFirst()
  assert.equal(isCurrentBubblesProvider(first), false)
  assert.equal(isCurrentBubblesProvider(second), false)
})

test('retired providers cannot reacquire on rerender while sequential effect replay can', async () => {
  const { acquireBubblesProviderOwnership, isCurrentBubblesProvider, isRetiredBubblesProvider } = await import('../../src/runtime/provider-ownership')
  const first = {}
  const second = {}
  const releaseFirst = acquireBubblesProviderOwnership(first, configuration, vi.fn())

  releaseFirst()
  assert.equal(isRetiredBubblesProvider(first), false)
  const releaseReplay = acquireBubblesProviderOwnership(first, configuration, vi.fn())
  const releaseSecond = acquireBubblesProviderOwnership(second, configuration, vi.fn())

  assert.equal(isRetiredBubblesProvider(first), true)
  const releaseStaleReacquire = acquireBubblesProviderOwnership(first, configuration, vi.fn())

  assert.equal(isCurrentBubblesProvider(second), true)
  releaseReplay()
  releaseStaleReacquire()
  assert.equal(isCurrentBubblesProvider(second), true)
  releaseSecond()
  acquireBubblesProviderOwnership(first, configuration, vi.fn())
  assert.equal(isCurrentBubblesProvider(first), false)
})

test.each([false, true])('a released owner cannot reclaim ownership after a replacement (different configuration: %s)', async (differentConfiguration) => {
  const { acquireBubblesProviderOwnership, isCurrentBubblesProvider, isRetiredBubblesProvider } = await import('../../src/runtime/provider-ownership')
  const hiddenOwner = {}
  const replacementOwner = {}
  const revokeHidden = vi.fn()
  const revokeReplacement = vi.fn()
  const releaseHidden = acquireBubblesProviderOwnership(hiddenOwner, configuration, revokeHidden)

  releaseHidden()
  assert.equal(isRetiredBubblesProvider(hiddenOwner), false)
  const replacementConfiguration = differentConfiguration ? { ...configuration, appId: 2 } : configuration
  const releaseReplacement = acquireBubblesProviderOwnership(replacementOwner, replacementConfiguration, revokeReplacement)

  assert.equal(isRetiredBubblesProvider(hiddenOwner), true)
  assert.equal(revokeHidden.mock.calls.length, 1)
  const releaseStaleReveal = acquireBubblesProviderOwnership(hiddenOwner, configuration, vi.fn())

  releaseHidden()
  releaseStaleReveal()
  assert.equal(isCurrentBubblesProvider(replacementOwner), true)
  assert.equal(revokeReplacement.mock.calls.length, 0)
  releaseReplacement()
  assert.equal(revokeReplacement.mock.calls.length, 1)
  const releaseAfterFinalCleanup = acquireBubblesProviderOwnership(hiddenOwner, configuration, vi.fn())

  assert.equal(isCurrentBubblesProvider(hiddenOwner), false)
  releaseAfterFinalCleanup()
})

test('conflicting configuration is rejected without revoking the current provider', async () => {
  const { acquireBubblesProviderOwnership, isCurrentBubblesProvider } = await import('../../src/runtime/provider-ownership')
  const owner = {}
  const revoke = vi.fn()
  const release = acquireBubblesProviderOwnership(owner, configuration, revoke)

  for (const conflicting of [
    { ...configuration, appId: 2 },
    { ...configuration, appKey: 'other' },
    { ...configuration, apiBaseUrl: 'https://other.test' },
    { ...configuration, oneSignalMigration: { policy: 'required' as const, oneSignalAppId: 'legacy', bridge: { getSubscriptionId: async () => null, subscribe: () => () => undefined } } }
  ]) {
    assert.throws(() => acquireBubblesProviderOwnership({}, conflicting, vi.fn()), /matching app credentials/)
    assert.equal(isCurrentBubblesProvider(owner), true)
    assert.equal(revoke.mock.calls.length, 0)
  }
  release()
})
