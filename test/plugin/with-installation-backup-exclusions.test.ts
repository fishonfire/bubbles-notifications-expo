import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { XML } from 'expo/config-plugins'
import { configureBackupResource, mergeBackupExclusions, updateAppDelegateBackupExclusions } from '../../plugin/src/with-installation-backup-exclusions'

// Assert the legacy root files are protected without running any storage API.
const SHARED_RESOURCE = '@xml/rules'
const protectedPaths = [
  'bubbles-notifications',
  'bubbles-notifications-installation-id.txt',
  'bubbles-notifications-installation-id.txt.tmp',
  'bubbles-notifications-expo-state.json',
  'bubbles-notifications-expo-delivery-status-ledger.json',
  'device-id.txt'
]
const exclusions = protectedPaths.map(storagePath => ({ $: { domain: 'file', path: storagePath } }))

test('backup rules preserve host rules and protect cloud and device transfers idempotently', async () => {
  const source = `<data-extraction-rules>
    <cloud-backup disableIfNoEncryptionCapabilities="true"><include domain="file" path="."/></cloud-backup>
    <device-transfer/>
    <cross-platform-transfer><include domain="file" path="."/></cross-platform-transfer>
  </data-extraction-rules>`
  const rules = mergeBackupExclusions(await XML.parseXMLAsync(source), true)
  const root = rules['data-extraction-rules'] as Record<string, { exclude: unknown[]; $?: unknown; include?: unknown[] }[]>

  for (const mode of ['cloud-backup', 'device-transfer', 'cross-platform-transfer']) assert.deepEqual(root[mode][0].exclude, exclusions)
  assert.deepEqual(root['cloud-backup'][0].$, { disableIfNoEncryptionCapabilities: 'true' })
  assert.equal(root['cloud-backup'][0].include?.length, 1)
  assert.deepEqual(mergeBackupExclusions(structuredClone(rules), true), rules)
  assert.deepEqual(mergeBackupExclusions(await XML.parseXMLAsync('<full-backup-content/>'), false), { 'full-backup-content': { exclude: exclusions } })
})

test('Android merges all host XML resource variants and creates defaults for new apps', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bubbles-backup-'))

  try {
    for (const variant of ['xml', 'xml-v31']) {
      await fs.mkdir(path.join(directory, variant))
      await fs.writeFile(path.join(directory, variant, 'host.xml'), '<data-extraction-rules><device-transfer><exclude domain="sharedpref" path="private.xml"/></device-transfer></data-extraction-rules>')
    }
    assert.equal(await configureBackupResource(directory, '@xml/host', true), '@xml/host')
    for (const variant of ['xml', 'xml-v31']) {
      const contents = await fs.readFile(path.join(directory, variant, 'host.xml'), 'utf8')

      assert.match(contents, /private.xml/)
      assert.match(contents, /bubbles-notifications/)
      assert.match(contents, /cloud-backup/)
    }
    assert.equal(await configureBackupResource(directory, 'false', false), 'false')
    assert.equal(await configureBackupResource(directory, undefined, false), '@xml/bubbles_backup_rules')
    assert.equal(await configureBackupResource(directory, undefined, true), '@xml/bubbles_data_extraction_rules')
    await assert.rejects(configureBackupResource(directory, '@xml/missing', true), /Cannot find backup resource/)
    await assert.rejects(configureBackupResource(directory, '@other:xml/rules', true), /Unsupported backup resource/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

for (const [language, source] of [
  ['swift', `import Expo
class AppDelegate: ExpoAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    factory.startReactNative()
    return true
  }
}`],
  ['objc', `#import "AppDelegate.h"
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application
  didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}
@end`]
] as const) {
  test(`iOS ${language} excludes storage before React starts and is idempotent`, () => {
    const updated = updateAppDelegateBackupExclusions(source, language)

    assert.match(updated, /bubbles-notifications/)
    assert.match(updated, language === 'swift' ? /contentsOfDirectory/ : /contentsOfDirectoryAtURL/)
    assert.match(updated, language === 'swift' ? /hasPrefix\("bubbles-notifications-"\)/ : /hasPrefix:@"bubbles-notifications-"/)
    assert.match(updated, /device-id.txt/)
    assert.match(updated, language === 'swift' ? /isExcludedFromBackup = true/ : /NSURLIsExcludedFromBackupKey/)
    assert.ok(updated.indexOf('bubbles-notifications') < updated.indexOf(language === 'swift' ? 'factory.startReactNative' : 'return [super'))
    assert.equal(updateAppDelegateBackupExclusions(updated, language), updated)
  })
}

test('unknown iOS startup shapes fail the build rather than silently omit backup protection', () => {
  assert.throws(() => updateAppDelegateBackupExclusions('unknown', 'swift'), /Cannot find/)
})

for (const modernFirst of [false, true]) {
  test(`Android preserves separate schemas under one resource name (modern first: ${modernFirst})`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bubbles-mixed-backup-'))
    const legacyFile = path.join(directory, 'xml', 'rules.xml')
    const modernFile = path.join(directory, 'xml-v31', 'rules.xml')
    const originalLegacy = '<full-backup-content><exclude domain="sharedpref" path="legacy.xml"/></full-backup-content>'
    const originalModern = '<data-extraction-rules><cloud-backup disableIfNoEncryptionCapabilities="true"/><device-transfer/></data-extraction-rules>'

    try {
      await fs.mkdir(path.dirname(legacyFile), { recursive: true })
      await fs.mkdir(path.dirname(modernFile), { recursive: true })
      await fs.writeFile(legacyFile, originalLegacy)
      await fs.writeFile(modernFile, originalModern)
      const modes = modernFirst ? [true, false] : [false, true]

      await configureBackupResource(directory, SHARED_RESOURCE, modes[0])
      assert.equal(await fs.readFile(modernFirst ? legacyFile : modernFile, 'utf8'), modernFirst ? originalLegacy : originalModern)
      await configureBackupResource(directory, SHARED_RESOURCE, modes[1])
      const legacy = await XML.parseXMLAsync(await fs.readFile(legacyFile, 'utf8'))
      const modern = await XML.parseXMLAsync(await fs.readFile(modernFile, 'utf8'))

      assert.deepEqual(Object.keys(legacy), ['full-backup-content'])
      assert.deepEqual(Object.keys(modern), ['data-extraction-rules'])
      const legacyRoot = legacy['full-backup-content'] as { exclude: unknown[] }
      const modernRoot = modern['data-extraction-rules'] as Record<string, { exclude: unknown[]; $?: unknown }[]>

      assert.deepEqual(legacyRoot.exclude, [{ $: { domain: 'sharedpref', path: 'legacy.xml' } }, ...exclusions])
      assert.deepEqual(modernRoot['cloud-backup'][0].exclude, exclusions)
      assert.deepEqual(modernRoot['device-transfer'][0].exclude, exclusions)
      assert.deepEqual(modernRoot['cloud-backup'][0].$, { disableIfNoEncryptionCapabilities: 'true' })
      for (const mode of modes) await configureBackupResource(directory, SHARED_RESOURCE, mode)
      assert.deepEqual(await XML.parseXMLAsync(await fs.readFile(legacyFile, 'utf8')), legacy)
      assert.deepEqual(await XML.parseXMLAsync(await fs.readFile(modernFile, 'utf8')), modern)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}

test('Android rejects a referenced resource with no matching schema without rewriting it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bubbles-wrong-backup-'))
  const filename = path.join(directory, 'xml', 'wrong.xml')
  const original = '<full-backup-content/>'

  try {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, original)
    await assert.rejects(configureBackupResource(directory, '@xml/wrong', true), /required <data-extraction-rules> root/)
    assert.equal(await fs.readFile(filename, 'utf8'), original)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
