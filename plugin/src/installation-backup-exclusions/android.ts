import fs from 'node:fs/promises'
import path from 'node:path'
import { XML } from 'expo/config-plugins'

import { DIRECTORY, LEGACY_FILES } from './storage-paths'

type XmlNode = Record<string, unknown>

function excludeInstallationStorage (node: XmlNode): void {
  const excludes = (node.exclude ?? []) as { $: Record<string, string> }[]

  // Legacy files must be protected as soon as the native update is installed,
  // even if JavaScript registration never runs to migrate them.
  for (const storagePath of [DIRECTORY, ...LEGACY_FILES]) {
    if (!excludes.some(item => item.$.domain === 'file' && item.$.path === storagePath)) {
      excludes.push({ $: { domain: 'file', path: storagePath } })
    }
  }
  node.exclude = excludes
}

/** Preserve host includes, exclusions and encryption settings in every backup mode. */
export function mergeBackupExclusions (xml: XmlNode, modern: boolean): XmlNode {
  if (!modern) {
    const root = xml['full-backup-content']
    const node = root && typeof root === 'object' ? root as XmlNode : {}

    excludeInstallationStorage(node)
    xml['full-backup-content'] = node

    return xml
  }
  const root = xml['data-extraction-rules']
  const node = root && typeof root === 'object' ? root as XmlNode : {}

  for (const mode of ['cloud-backup', 'device-transfer', 'cross-platform-transfer']) {
    // Do not enable cross-platform transfer for hosts that have not enabled it.
    if (mode === 'cross-platform-transfer' && !node[mode]) {
      continue
    }

    const sections = (node[mode] ?? [{}]) as XmlNode[]

    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]

      if (!section || typeof section !== 'object') {
        sections[index] = {}
      }
      excludeInstallationStorage(sections[index])
    }
    node[mode] = sections
  }
  xml['data-extraction-rules'] = node

  return xml
}

async function findBackupResources (resourceDirectory: string, resourceName: string): Promise<string[]> {
  const directories = (await fs.readdir(resourceDirectory)).filter(name => /^xml(?:-|$)/.test(name))
  const candidates = directories.map(name => path.join(resourceDirectory, name, `${resourceName}.xml`))
  const existing: string[] = []

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      existing.push(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  return existing
}

async function writeBackupResource (filename: string, xml: XmlNode, modern: boolean): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(filename, XML.format(mergeBackupExclusions(xml, modern)))
}

async function updateBackupResources (filenames: string[], modern: boolean): Promise<void> {
  const expectedRoot = modern ? 'data-extraction-rules' : 'full-backup-content'
  let matchingResources = 0

  for (const filename of filenames) {
    const xml = await XML.parseXMLAsync(await fs.readFile(filename, 'utf8'))

    // A host may use one resource name with a different schema in xml-v31.
    // Only the pass for that file's actual schema may modify it.
    if (!Object.prototype.hasOwnProperty.call(xml, expectedRoot)) {
      continue
    }
    await writeBackupResource(filename, xml, modern)
    matchingResources++
  }
  if (matchingResources === 0) {
    throw new Error(`[BubblesNotifications] No backup resource has the required <${expectedRoot}> root.`)
  }
}

export async function configureBackupResource (
  resourceDirectory: string,
  reference: string | undefined,
  modern: boolean
): Promise<string> {
  if (reference === 'false' && !modern) {
    return reference
  }

  const defaultName = modern ? 'bubbles_data_extraction_rules' : 'bubbles_backup_rules'
  const resourceName = reference && reference !== 'true'
    ? /^@xml\/([a-z0-9_]+)$/.exec(reference)?.[1]
    : defaultName

  if (!resourceName) {
    throw new Error(`[BubblesNotifications] Unsupported backup resource: ${reference}`)
  }
  await fs.mkdir(resourceDirectory, { recursive: true })
  const existing = await findBackupResources(resourceDirectory, resourceName)

  if (existing.length === 0 && reference?.startsWith('@')) {
    throw new Error(`[BubblesNotifications] Cannot find backup resource ${reference}; provide a local XML resource so installation exclusions can be merged.`)
  }
  if (existing.length === 0) {
    const filename = path.join(resourceDirectory, 'xml', `${resourceName}.xml`)

    await writeBackupResource(filename, {}, modern)
  } else {
    await updateBackupResources(existing, modern)
  }

  return `@xml/${resourceName}`
}
