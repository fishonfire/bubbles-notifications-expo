import { ConfigPlugin, withPodfile } from '@expo/config-plugins'

const withRNFirebaseDisableSPM: ConfigPlugin = (config) => {
  return withPodfile(config, (config) => {
    const flag = '$RNFirebaseDisableSPM = true'

    if (!config.modResults.contents.includes(flag)) {
      config.modResults.contents =
        `${flag}\n${config.modResults.contents}`
    }

    return config
  })
}

export default withRNFirebaseDisableSPM;
