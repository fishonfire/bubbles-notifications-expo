import { failWithBubblesError } from './errors';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getRequiredNonEmptyString(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value !== 'string') {
    failWithBubblesError(`"${fieldName}" must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    failWithBubblesError(`"${fieldName}" must not be empty.`);
  }

  return trimmedValue;
}

export function getRequiredNonEmptyStringFromSource(
  value: unknown,
  sourceDescription: string,
): string {
  if (typeof value !== 'string') {
    failWithBubblesError(`${sourceDescription} must be a string.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    failWithBubblesError(`${sourceDescription} must not be empty.`);
  }

  return trimmedValue;
}

export function normalizeIdentifier(
  value: unknown,
  fieldName: string,
): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      failWithBubblesError(
        `"${fieldName}" must be a finite number when it is numeric.`,
      );
    }

    return String(value);
  }

  if (typeof value !== 'string') {
    failWithBubblesError(`"${fieldName}" must be a string or number.`);
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    failWithBubblesError(`"${fieldName}" must not be empty.`);
  }

  return trimmedValue;
}
