import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

const API_BASE_URL = 'https://api.example.com'
const STAGING_API_BASE_URL = 'https://api.staging.example.com'
const PRODUCTION_API_BASE_URL = 'https://api.production.example.com'
const LEGACY_DEVICE_ID = 'legacy-device-id'

const PADDED_API_BASE_URL = ` ${API_BASE_URL} `
const PADDED_STAGING_API_BASE_URL = ` ${STAGING_API_BASE_URL} `
const PADDED_PRODUCTION_API_BASE_URL = ` ${PRODUCTION_API_BASE_URL} `
const PADDED_LEGACY_DEVICE_ID = ` ${LEGACY_DEVICE_ID} `

const fileContents = new Map<string, string>()
const fileMoves: { from: string; to: string; overwrite: boolean }[] = []
const documentDirectory = '/mock/document'
const storedStateUri =
  `${documentDirectory}/bubbles-notifications-expo-state.json`
const legacyDeviceIdUri = `${documentDirectory}/device-id.txt`

class MockFile {
  uri: string

  constructor (basePath: string, fileName: string) {
    this.uri = `${basePath}/${fileName}`
  }

  get exists () {
    return fileContents.has(this.uri)
  }

  create () {
    if (!fileContents.has(this.uri)) {
      fileContents.set(this.uri, '')
    }
  }

  textSync () {
    const value = fileContents.get(this.uri)

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`)
    }

    return value
  }

  async text () {
    return this.textSync()
  }

  write (value: string) {
    fileContents.set(this.uri, value)
  }

  delete () {
    if (!fileContents.delete(this.uri)) {
      throw new Error(`Missing file: ${this.uri}`)
    }
  }

  moveSync (destination: MockFile, options?: { overwrite?: boolean }) {
    const value = fileContents.get(this.uri)

    if (value === undefined) {
      throw new Error(`Missing file: ${this.uri}`)
    }

    if (fileContents.has(destination.uri) && !options?.overwrite) {
      throw new Error(`Destination exists: ${destination.uri}`)
    }

    fileMoves.push({
      from: this.uri,
      to: destination.uri,
      overwrite: options?.overwrite === true
    })
    fileContents.set(destination.uri, value)
    fileContents.delete(this.uri)
    this.uri = destination.uri
  }

  async move (destination: MockFile, options?: { overwrite?: boolean }) {
    this.moveSync(destination, options)
  }
}

vi.doMock('expo-file-system', () => ({
  File: MockFile,
  Paths: {
    document: documentDirectory
  }
}))

const {
  patchStoredDeviceStateAsync,
  patchStoredDeviceState,
  readStoredApiBaseUrlAsync,
  readStoredApiBaseUrl,
  readStoredAppKeyAsync,
  readStoredAppKey,
  readStoredDeviceIdAsync,
  readStoredDeviceId,
  readStoredDeviceStateAsync,
  readStoredDeviceState,
  storeApiBaseUrlAsync,
  storeApiBaseUrl,
  storeAppKeyAsync,
  storeAppKey,
  storeDeviceIdAsync,
  storeDeviceId,
  storeDeviceStateAsync,
  storeDeviceState
} = await import('../../src/storage/device-state.ts')

beforeEach(() => {
  fileContents.clear()
  fileMoves.length = 0
})

test('reads an empty device state when no package-owned state exists', () => {
  assert.deepEqual(readStoredDeviceState(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null
  })
  assert.equal(readStoredDeviceId(), null)
  assert.equal(readStoredApiBaseUrl(), null)
  assert.equal(readStoredAppKey(), null)
})

test('stores and patches structured device state', () => {
  const storedState = storeDeviceState({
    deviceId: ' device-1 ',
    apiBaseUrl: PADDED_API_BASE_URL,
    appKey: ' app-key-1 '
  })

  assert.deepEqual(storedState, {
    deviceId: 'device-1',
    apiBaseUrl: API_BASE_URL,
    appKey: 'app-key-1'
  })
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify(
      {
        version: 2,
        deviceId: 'device-1',
        apiBaseUrl: API_BASE_URL,
        appKey: 'app-key-1'
      },
      null,
      2
    )
  )

  const patchedState = patchStoredDeviceState({
    apiBaseUrl: PADDED_STAGING_API_BASE_URL
  })

  assert.deepEqual(patchedState, {
    deviceId: 'device-1',
    apiBaseUrl: STAGING_API_BASE_URL,
    appKey: 'app-key-1'
  })
  assert.deepEqual(readStoredDeviceState(), patchedState)

  storeDeviceId(' device-2 ')
  assert.equal(readStoredDeviceId(), 'device-2')

  storeApiBaseUrl(PADDED_PRODUCTION_API_BASE_URL)
  assert.equal(readStoredApiBaseUrl(), PRODUCTION_API_BASE_URL)

  storeAppKey(' app-key-2 ')
  assert.equal(readStoredAppKey(), 'app-key-2')
})

test('stores and patches structured device state asynchronously', async () => {
  const storedState = await storeDeviceStateAsync({
    deviceId: ' device-1 ',
    apiBaseUrl: PADDED_API_BASE_URL,
    appKey: ' app-key-1 '
  })

  assert.deepEqual(storedState, {
    deviceId: 'device-1',
    apiBaseUrl: API_BASE_URL,
    appKey: 'app-key-1'
  })

  const patchedState = await patchStoredDeviceStateAsync({
    apiBaseUrl: PADDED_STAGING_API_BASE_URL
  })

  assert.deepEqual(patchedState, {
    deviceId: 'device-1',
    apiBaseUrl: STAGING_API_BASE_URL,
    appKey: 'app-key-1'
  })
  assert.deepEqual(await readStoredDeviceStateAsync(), patchedState)

  await storeDeviceIdAsync(' device-2 ')
  assert.equal(await readStoredDeviceIdAsync(), 'device-2')

  await storeApiBaseUrlAsync(PADDED_PRODUCTION_API_BASE_URL)
  assert.equal(
    await readStoredApiBaseUrlAsync(),
    PRODUCTION_API_BASE_URL
  )

  await storeAppKeyAsync(' app-key-2 ')
  assert.equal(await readStoredAppKeyAsync(), 'app-key-2')
})

test('serializes concurrent updates without losing fields', async () => {
  await Promise.all([
    storeDeviceIdAsync('device-1'),
    storeApiBaseUrlAsync(API_BASE_URL),
    storeAppKeyAsync('app-key-1')
  ])

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: 'device-1',
    apiBaseUrl: API_BASE_URL,
    appKey: 'app-key-1'
  })
})

test('replaces state atomically through a temporary file', async () => {
  await storeDeviceIdAsync('device-1')

  assert.ok(
    fileMoves.some(
      ({ from, to, overwrite }) =>
        from.startsWith(`${storedStateUri}.tmp-`) &&
        to === storedStateUri &&
        overwrite
    )
  )
  assert.equal(
    [...fileContents.keys()].some((uri) => uri.includes('.tmp-')),
    false
  )
})

test('falls back to the legacy device-id file when structured state is missing', () => {
  fileContents.set(legacyDeviceIdUri, PADDED_LEGACY_DEVICE_ID)

  assert.deepEqual(readStoredDeviceState(), {
    deviceId: LEGACY_DEVICE_ID,
    apiBaseUrl: null,
    appKey: null
  })
  assert.equal(fileContents.has(legacyDeviceIdUri), false)
  assert.match(fileContents.get(storedStateUri) ?? '', /legacy-device-id/)
})

test('falls back to the legacy device-id file asynchronously when structured state is missing', async () => {
  fileContents.set(legacyDeviceIdUri, PADDED_LEGACY_DEVICE_ID)

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: LEGACY_DEVICE_ID,
    apiBaseUrl: null,
    appKey: null
  })
  assert.equal(fileContents.has(legacyDeviceIdUri), false)
})

test('does not resurrect a cleared ID from the legacy file', async () => {
  fileContents.set(legacyDeviceIdUri, LEGACY_DEVICE_ID)
  await readStoredDeviceStateAsync()
  await storeDeviceIdAsync(null)

  fileContents.set(legacyDeviceIdUri, LEGACY_DEVICE_ID)

  assert.equal(await readStoredDeviceIdAsync(), null)
  assert.equal(fileContents.has(legacyDeviceIdUri), false)
})

test('quarantines malformed stored state and recovers synchronously', () => {
  fileContents.set(storedStateUri, '{this is not valid json')

  assert.deepEqual(readStoredDeviceState(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null
  })
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify({ version: 2 }, null, 2)
  )
  assert.ok(
    [...fileContents.keys()].some((uri) => uri.includes('.corrupt-'))
  )
})

test('quarantines malformed stored state and recovers asynchronously', async () => {
  fileContents.set(storedStateUri, '{this is not valid json')

  assert.deepEqual(await readStoredDeviceStateAsync(), {
    deviceId: null,
    apiBaseUrl: null,
    appKey: null
  })
  assert.equal(
    fileContents.get(storedStateUri),
    JSON.stringify({ version: 2 }, null, 2)
  )
  assert.ok(
    [...fileContents.keys()].some((uri) => uri.includes('.corrupt-'))
  )
})
