import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ConfigPlugin,
  withDangerousMod,
} from 'expo/config-plugins';

import type {
  NormalizedBubblesNotificationsExpoPluginConfig,
} from './config';

const REGISTRAR_CLASS = 'BubblesFirebaseMessagingRegistrar';

const withFirebaseMessagingRegistration: ConfigPlugin<
  NormalizedBubblesNotificationsExpoPluginConfig
> = (config, options) => {
  return withDangerousMod(config, [
    'android',
    async config => {
      if (!options.enableFirebaseInstallationPushRegistration) {
        await removeFirebaseMessagingRegistrarSources(
          path.join(
            config.modRequest.projectRoot,
            'android', 'app', 'src', 'main', 'java',
          ),
        );
        return config;
      }

      const packageName = getAndroidPackageName(config);
      const sourceDirectory = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        ...packageName.split('.'),
      );

      await fs.mkdir(sourceDirectory, { recursive: true });
      await fs.writeFile(
        path.join(sourceDirectory, `${REGISTRAR_CLASS}.java`),
        buildFirebaseMessagingRegistrarSource(packageName),
      );

      return config;
    },
  ]);
};

async function removeFirebaseMessagingRegistrarSources(
  directory: string,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeFirebaseMessagingRegistrarSources(entryPath);
    } else if (entry.isFile() && entry.name === `${REGISTRAR_CLASS}.java`) {
      await fs.unlink(entryPath);
    }
  }
}

function getAndroidPackageName(config: {
  android?: {
    package?: string;
  };
}): string {
  const packageName = config.android?.package?.trim();

  if (!packageName) {
    throw new Error(
      '[@fishonfire/bubbles-expo] "expo.android.package" is required to configure Android Firebase Messaging registration.',
    );
  }

  return packageName;
}

function buildFirebaseMessagingRegistrarSource(
  packageName: string,
): string {
  return `package ${packageName};

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

public final class ${REGISTRAR_CLASS} extends ContentProvider {
  private static final String TAG = "BubblesFCMRegistrar";

  @Override
  public boolean onCreate() {
    try {
      Class<?> firebaseAppClass = Class.forName("com.google.firebase.FirebaseApp");
      Class<?> firebaseMessagingClass = Class.forName("com.google.firebase.messaging.FirebaseMessaging");

      if (getContext() != null) {
        Object apps = firebaseAppClass
            .getMethod("getApps", android.content.Context.class)
            .invoke(null, getContext());

        if (apps instanceof java.util.List && ((java.util.List<?>) apps).isEmpty()) {
          firebaseAppClass
              .getMethod("initializeApp", android.content.Context.class)
              .invoke(null, getContext());
        }
      }

      Object messaging = firebaseMessagingClass
          .getMethod("getInstance")
          .invoke(null);

      firebaseMessagingClass
          .getMethod("register")
          .invoke(messaging);
    } catch (ReflectiveOperationException | RuntimeException error) {
      Log.w(TAG, "Failed to start Firebase Messaging registration.", error);
    }

    return false;
  }

  @Nullable
  @Override
  public Cursor query(
      @NonNull Uri uri,
      @Nullable String[] projection,
      @Nullable String selection,
      @Nullable String[] selectionArgs,
      @Nullable String sortOrder) {
    return null;
  }

  @Nullable
  @Override
  public String getType(@NonNull Uri uri) {
    return null;
  }

  @Nullable
  @Override
  public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
    return null;
  }

  @Override
  public int delete(
      @NonNull Uri uri,
      @Nullable String selection,
      @Nullable String[] selectionArgs) {
    return 0;
  }

  @Override
  public int update(
      @NonNull Uri uri,
      @Nullable ContentValues values,
      @Nullable String selection,
      @Nullable String[] selectionArgs) {
    return 0;
  }
}
`;
}

export default withFirebaseMessagingRegistration;
