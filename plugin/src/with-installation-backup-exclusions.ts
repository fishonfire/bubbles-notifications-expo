import path from 'node:path'
import { AndroidConfig, ConfigPlugin, withAndroidManifest, withAppDelegate } from 'expo/config-plugins'

import { configureBackupResource } from './installation-backup-exclusions/android'
import { updateAppDelegateBackupExclusions } from './installation-backup-exclusions/ios'

export { configureBackupResource, mergeBackupExclusions } from './installation-backup-exclusions/android'
export { updateAppDelegateBackupExclusions } from './installation-backup-exclusions/ios'

const withInstallationBackupExclusions: ConfigPlugin = config => {
  config = withAndroidManifest(config, async config => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults)
    const resources = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')

    if (!config.modRequest.introspect) {
      application.$['android:fullBackupContent'] = await configureBackupResource(
        resources,
        application.$['android:fullBackupContent'],
        false
      )
      application.$['android:dataExtractionRules'] = await configureBackupResource(
        resources,
        application.$['android:dataExtractionRules'],
        true
      )
    }

    return config
  })

  return withAppDelegate(config, config => {
    const { contents, language } = config.modResults

    config.modResults.contents = updateAppDelegateBackupExclusions(contents, language)

    return config
  })
}

export default withInstallationBackupExclusions
