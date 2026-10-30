import fs from 'node:fs/promises'
import path from 'node:path'
import { AndroidConfig, ConfigPlugin, XML, withAndroidManifest, withAppDelegate } from 'expo/config-plugins'
import { mergeContents, removeContents } from '@expo/config-plugins/build/utils/generateCode'

const DIRECTORY = 'bubbles-notifications'
const TAG = '@fishonfire/bubbles-expo-installation-backup-exclusions'

type XmlNode = Record<string, unknown>

function excludeDirectory (node: XmlNode): void {
  const excludes = (node.exclude ?? []) as { $: Record<string, string> }[]

  if (!excludes.some(item => item.$.domain === 'file' && item.$.path === DIRECTORY)) {
    excludes.push({ $: { domain: 'file', path: DIRECTORY } })
  }
  node.exclude = excludes
}

/** Preserve host includes, exclusions and encryption settings in every backup mode. */
export function mergeBackupExclusions (xml: XmlNode, modern: boolean): XmlNode {
  if (!modern) {
    const root = xml['full-backup-content']
    const node = root && typeof root === 'object' ? root as XmlNode : {}

    excludeDirectory(node)
    xml['full-backup-content'] = node

    return xml
  }
  const root = xml['data-extraction-rules']
  const node = root && typeof root === 'object' ? root as XmlNode : {}

  for (const mode of ['cloud-backup', 'device-transfer', 'cross-platform-transfer']) {
    // Do not enable cross-platform transfer for hosts that have not enabled it.
    if (mode === 'cross-platform-transfer' && !node[mode]) continue
    const sections = (node[mode] ?? [{}]) as XmlNode[]

    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]

      if (!section || typeof section !== 'object') sections[index] = {}
      excludeDirectory(sections[index])
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
    try { await fs.access(candidate); existing.push(candidate) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  return existing
}

export async function configureBackupResource (
  resourceDirectory: string,
  reference: string | undefined,
  modern: boolean
): Promise<string> {
  if (reference === 'false' && !modern) return reference
  const defaultName = modern ? 'bubbles_data_extraction_rules' : 'bubbles_backup_rules'
  const resourceName = reference && reference !== 'true' ? /^@xml\/([a-z0-9_]+)$/.exec(reference)?.[1] : defaultName

  if (!resourceName) throw new Error(`[BubblesNotifications] Unsupported backup resource: ${reference}`)
  await fs.mkdir(resourceDirectory, { recursive: true })
  const existing = await findBackupResources(resourceDirectory, resourceName)

  if (existing.length === 0 && reference?.startsWith('@')) {
    throw new Error(`[BubblesNotifications] Cannot find backup resource ${reference}; provide a local XML resource so installation exclusions can be merged.`)
  }
  if (existing.length === 0) existing.push(path.join(resourceDirectory, 'xml', `${resourceName}.xml`))
  for (const filename of existing) {
    let xml: XmlNode = {}

    try { xml = await XML.parseXMLAsync(await fs.readFile(filename, 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, XML.format(mergeBackupExclusions(xml, modern)))
  }

  return `@xml/${resourceName}`
}

export function updateAppDelegateBackupExclusions (contents: string, language: string): string {
  let src = removeContents({ src: contents, tag: TAG }).contents
  const swift = language === 'swift'

  if (swift && !/^\s*import Foundation\s*$/m.test(src)) src = `import Foundation\n${src}`

  if (!swift && language !== 'objc' && language !== 'objcpp') throw new Error(`[BubblesNotifications] Unsupported AppDelegate language: ${language}`)
  const method = swift
    ? /func\s+application\([^)]*didFinishLaunchingWithOptions[^)]*\)\s*->\s*Bool\s*\{/.exec(src)
    : /-\s*\(BOOL\)\s*application:\s*\(UIApplication\s*\*\s*\)\w+[^;{]*didFinishLaunchingWithOptions:[^;{]*\{/.exec(src)

  if (!method) throw new Error('[BubblesNotifications] Cannot find AppDelegate launch method to protect installation storage.')
  const block = swift
    ? `do {
      var bubblesDirectory = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("${DIRECTORY}", isDirectory: true)
      try FileManager.default.createDirectory(at: bubblesDirectory, withIntermediateDirectories: true, attributes: nil)
      var bubblesValues = URLResourceValues()
      bubblesValues.isExcludedFromBackup = true
      try bubblesDirectory.setResourceValues(bubblesValues)
    } catch {
      fatalError("[BubblesNotifications] Cannot exclude installation storage from backup: \\(error)")
    }`
    : `NSURL *bubblesDirectory = [[[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"${DIRECTORY}" isDirectory:YES];
  NSError *bubblesBackupError = nil;
  if (![[NSFileManager defaultManager] createDirectoryAtURL:bubblesDirectory withIntermediateDirectories:YES attributes:nil error:&bubblesBackupError] ||
      ![bubblesDirectory setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&bubblesBackupError]) {
    @throw [NSException exceptionWithName:@"BubblesBackupExclusionError" reason:[bubblesBackupError localizedDescription] userInfo:nil];
  }`

  return mergeContents({
    tag: TAG, src, newSrc: block, anchor: /^/,
    offset: src.slice(0, method.index + method[0].length).split('\n').length,
    comment: '//'
  }).contents
}

const withInstallationBackupExclusions: ConfigPlugin = config => {
  config = withAndroidManifest(config, async config => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults)
    const resources = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')

    if (!config.modRequest.introspect) {
      application.$['android:fullBackupContent'] = await configureBackupResource(resources, application.$['android:fullBackupContent'], false)
      application.$['android:dataExtractionRules'] = await configureBackupResource(resources, application.$['android:dataExtractionRules'], true)
    }

    return config
  })

  return withAppDelegate(config, config => {
    config.modResults.contents = updateAppDelegateBackupExclusions(config.modResults.contents, config.modResults.language)

    return config
  })
}

export default withInstallationBackupExclusions
