import { createApi, unwrap } from '@shared/bridge'
import type { Envelope, StreamlineApi } from '@shared/bridge'

const TOKEN_KEY = 'streamline.token'

/** The tray can deep-link a page, e.g. `#token=…&page=drivers`. Read before the hash is cleared. */
export const initialPage = /[#&]page=(\w+)/.exec(window.location.hash)?.[1] ?? null

/**
 * The tray opens the UI as http://127.0.0.1:<port>/#token=<secret>. Keep the
 * secret for this tab and drop it from the address bar so it isn't bookmarked.
 */
function sessionToken(): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(window.location.hash)
  if (match) {
    try {
      sessionStorage.setItem(TOKEN_KEY, match[1])
    } catch {
      // Storage can be unavailable; the token still works for this page load.
    }
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return match[1]
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function createHttpApi(): StreamlineApi {
  const token = sessionToken()
  return createApi(async <T>(channel: string, ...args: unknown[]) => {
    const response = await fetch('/api/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Streamline-Token': token },
      body: JSON.stringify({ channel, args })
    })
    if (response.status === 401) {
      throw new Error('This page has expired. Open it again from the Streamline tray icon.')
    }
    return unwrap(channel, (await response.json()) as Envelope<T>)
  })
}

/** The main process, reached through the local web server the tray opens. */
export const api: StreamlineApi = createHttpApi()

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
