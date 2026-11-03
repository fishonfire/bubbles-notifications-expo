import { Directory, File, Paths } from 'expo-file-system'

// Keep installation identity, bindings and delivery receipts together. The native
// config plugin excludes this directory from cloud backup and device transfer.
export const PRIVATE_STORAGE_DIRECTORY = 'bubbles-notifications'

export function getPrivateFile (name: string): File {
  const directory = new Directory(Paths.document, PRIVATE_STORAGE_DIRECTORY)

  directory.create({ idempotent: true, intermediates: true })
  const destination = new File(directory.uri, name)
  const legacy = new File(Paths.document, name)

  // Moving preserves an existing installation on upgrade. Never overwrite newer
  // state with a leftover legacy file after a partially completed migration.
  if (!destination.exists && legacy.exists) legacy.moveSync(destination)

  return destination
}
