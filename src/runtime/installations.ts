import { getId, getInstallations } from '@react-native-firebase/installations';

import type { SupportedPlatform } from '../internal/platform';
import {
  getRequiredNonEmptyStringFromSource,
} from '../internal/validation';
import {
  failWithBubblesError,
  getErrorMessage,
} from '../internal/errors';

export async function getFirebaseInstallationId(
  platform: SupportedPlatform,
): Promise<string> {
  try {
    const installationsInstance = getInstallations();
    const installationId = await getId(installationsInstance);

    return getRequiredNonEmptyStringFromSource(
      installationId,
      `${platform} Firebase installation id from Firebase Installations`,
    );
  } catch (error) {
    const reason = getErrorMessage(error);
    const platformSpecificSetupHint =
      platform === 'ios'
        ? ' On iOS, ensure `expo.ios.googleServicesFile` is configured and the native app has been rebuilt.'
        : ' On Android, ensure `expo.android.googleServicesFile` is configured and the native app has been rebuilt.';

    failWithBubblesError(
      `Failed to get a ${platform} Firebase installation id from Firebase Installations. Ensure "@react-native-firebase/app" and "@react-native-firebase/installations" are installed and Firebase is configured for this platform.${platformSpecificSetupHint} Original error: ${reason}`,
    );
  }
}
