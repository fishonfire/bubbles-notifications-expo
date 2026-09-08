import {
  ANDROID_CHANNEL_IMPORTANCE_VALUES,
  type AndroidChannelImportance,
} from './shared-config';

export type BubblesNotificationsExpoPluginConfig = {
  defaultChannelId?: string;
  defaultChannelName?: string;
  androidChannelImportance?: AndroidChannelImportance;
  androidNotificationIcon?: string;
  androidNotificationColor?: string;
  enableBackgroundRemoteNotifications?: boolean;
};

export type NormalizedBubblesNotificationsExpoPluginConfig = {
  defaultChannelId: string;
  defaultChannelName: string;
  androidChannelImportance: AndroidChannelImportance;
  androidNotificationIcon?: string;
  androidNotificationColor?: string;
  enableBackgroundRemoteNotifications: boolean;
};

function fail(message: string): never {
  throw new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

function assertPlainObjectOrUndefined(
  value: unknown,
): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) {
    return;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'Plugin options must be an object, for example ["@fishonfire/bubbles-expo", { "defaultChannelId": "default" }].',
    );
  }
}

function getOptionalNonEmptyString(
  value: unknown,
  propertyName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    fail(`"${propertyName}" must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    fail(`"${propertyName}" must not be empty.`);
  }

  return trimmedValue;
}

function getBooleanWithDefault(
  value: unknown,
  propertyName: string,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'boolean') {
    fail(`"${propertyName}" must be a boolean.`);
  }

  return value;
}

function getAndroidChannelImportance(
  value: unknown,
): AndroidChannelImportance {
  if (value === undefined) {
    return 'max';
  }

  if (
    typeof value !== 'string' ||
    !ANDROID_CHANNEL_IMPORTANCE_VALUES.includes(
      value as AndroidChannelImportance,
    )
  ) {
    fail(
      `"androidChannelImportance" must be one of: ${ANDROID_CHANNEL_IMPORTANCE_VALUES.join(
        ', ',
      )}.`,
    );
  }

  return value as AndroidChannelImportance;
}

function getOptionalNotificationColor(
  value: unknown,
): string | undefined {
  const color = getOptionalNonEmptyString(
    value,
    'androidNotificationColor',
  );

  if (color === undefined) {
    return undefined;
  }

  if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    fail(
      '"androidNotificationColor" must be a hex color in #RRGGBB or #AARRGGBB format.',
    );
  }

  return color;
}

export function normalizePluginConfig(
  input?: BubblesNotificationsExpoPluginConfig | void,
): NormalizedBubblesNotificationsExpoPluginConfig {
  assertPlainObjectOrUndefined(input);

  const options = input ?? {};

  return {
    defaultChannelId:
      getOptionalNonEmptyString(
        options.defaultChannelId,
        'defaultChannelId',
      ) ?? 'default',

    defaultChannelName:
      getOptionalNonEmptyString(
        options.defaultChannelName,
        'defaultChannelName',
      ) ?? 'Default',

    androidChannelImportance: getAndroidChannelImportance(
      options.androidChannelImportance,
    ),

    androidNotificationIcon: getOptionalNonEmptyString(
      options.androidNotificationIcon,
      'androidNotificationIcon',
    ),

    androidNotificationColor: getOptionalNotificationColor(
      options.androidNotificationColor,
    ),

    enableBackgroundRemoteNotifications: getBooleanWithDefault(
      options.enableBackgroundRemoteNotifications,
      'enableBackgroundRemoteNotifications',
      true,
    ),
  };
}
