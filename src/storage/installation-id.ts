import { readStoredDeviceStateAsync } from './device-state'
import { randomUUID } from 'expo-crypto'
import { File, Paths } from 'expo-file-system'

const FILE_NAME = 'bubbles-notifications-installation-id.txt'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let queue: Promise<void> = Promise.resolve()

/** A corrupt identity requires deliberate host recovery; it never silently becomes a new device. */
export function getOrCreateInstallationId (): Promise<string> {
  const result = queue.then(async () => {
    const destination = new File(Paths.document, FILE_NAME)

    if (destination.exists) {
      const id = (await destination.text()).trim()

      if (!UUID.test(id)) throw new Error('Bubbles installation identity is corrupt; restore or explicitly remove the identity file before retrying.')

      return id
    }
    const state = await readStoredDeviceStateAsync()

    if (state.acknowledgedInstallationId) throw new Error('Bubbles installation identity is missing for an existing binding; explicit identity recovery is required.')
    const id = randomUUID()

    if (!UUID.test(id)) throw new Error('Secure UUID generation failed.')
    const temporary = new File(Paths.document, `${FILE_NAME}.tmp`)

    try {
      temporary.write(id)
      await temporary.move(destination, { overwrite: true })
    } finally {
      if (temporary.exists && temporary.uri !== destination.uri) temporary.delete()
    }

    return id
  })

  queue = result.then(() => undefined, () => undefined)

  return result
}
