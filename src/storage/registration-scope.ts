/** Scope includes the backend base path and app, but deliberately excludes rotating credentials. */
export function getRegistrationScope (apiBaseUrl: string, appId: string | number): string {
  const url = new URL(apiBaseUrl.trim())

  url.search = ''
  url.hash = ''

  return JSON.stringify([url.toString().replace(/\/+$/, ''), String(appId).trim()])
}
