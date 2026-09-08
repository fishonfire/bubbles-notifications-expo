export function createBubblesError(message: string): Error {
  return new Error(`[@fishonfire/bubbles-expo] ${message}`);
}

export function failWithBubblesError(message: string): never {
  throw createBubblesError(message);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
