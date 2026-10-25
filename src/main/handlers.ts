import { app, shell } from 'electron'
import { CHANNELS } from '@shared/channels'
import type {
  AppInfo,
  DriverReport,
  LightingMode,
  LightingState,
  LightingStatus,
  Settings,
  ThemePreference
} from '@shared/types'
import type { AuraService } from './services/aura'
import { isVendorLightingServiceRunning, parseHexColor } from './services/aura'
import { checkDrivers } from './services/drivers'
import type { Logger } from './services/logger'
import type { Paths } from './services/paths'
import type { Store } from './store'

export interface HandlerContext {
  paths: Paths
  store: Store
  logger: Logger
  aura: AuraService
  /** Called after settings change so the tray and login item can follow. */
  onSettingsChanged: (settings: Settings) => void
  /** Called after lighting is applied so the tray menu can tick the mode. */
  onLightingChanged: (state: LightingState) => void
}

export interface HandlerResult<T> {
  ok: boolean
  value?: T
  error?: string
}

/** Every request the web UI can make; results come back in an envelope. */
export type Handler = (...args: unknown[]) => Promise<HandlerResult<unknown>>

const THEMES: ThemePreference[] = ['dark', 'light', 'system']
export const LIGHTING_MODES: LightingMode[] = ['off', 'static', 'breathing', 'flashing', 'spectrum', 'rainbow']

/** The web UI is untrusted input: rebuild the state from known fields only. */
export function sanitizeLighting(input: Partial<LightingState>): LightingState {
  if (!input || !LIGHTING_MODES.includes(input.mode as LightingMode)) throw new Error('Unknown lighting mode')
  const color = String(input.color ?? '')
  parseHexColor(color)
  return { mode: input.mode as LightingMode, color: color.toLowerCase(), includeHeaders: input.includeHeaders === true }
}

function sanitizeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next = { ...current }
  if (patch && THEMES.includes(patch.theme as ThemePreference)) next.theme = patch.theme as ThemePreference
  if (patch && typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent)) next.accent = patch.accent
  if (patch && typeof patch.startWithWindows === 'boolean') next.startWithWindows = patch.startWithWindows
  return next
}

export function createHandlers(context: HandlerContext): Map<string, Handler> {
  const { paths, store, logger, aura } = context
  const handlers = new Map<string, Handler>()

  /** Register a handler with uniform error capture. */
  const handle = <T>(channel: string, handler: (...args: never[]) => T | Promise<T>): void => {
    handlers.set(channel, async (...args: unknown[]) => {
      try {
        return { ok: true, value: await (handler as (...a: unknown[]) => T | Promise<T>)(...args) }
      } catch (error) {
        logger.error('api', `${channel} failed: ${String(error)}`)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  handle<AppInfo>(CHANNELS.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    dataDir: paths.root
  }))

  // ---- Settings -----------------------------------------------------------
  handle<Settings>(CHANNELS.settingsGet, () => ({ ...store.settings }))

  handle<Settings>(CHANNELS.settingsUpdate, (patch: Partial<Settings>) => {
    const settings = store.mutate((db) => {
      db.settings = sanitizeSettings(db.settings, patch)
      return { ...db.settings }
    })
    context.onSettingsChanged(settings)
    return settings
  })

  // ---- Lighting -----------------------------------------------------------
  const lightingStatus = async (): Promise<LightingStatus> => ({
    devices: await aura.list(),
    vendorServiceRunning: await isVendorLightingServiceRunning(),
    saved: store.snapshot.lighting
  })

  handle<LightingStatus>(CHANNELS.lightingStatus, lightingStatus)

  handle<LightingStatus>(CHANNELS.lightingApply, async (input: Partial<LightingState>) => {
    const state = sanitizeLighting(input)
    await aura.apply(state)
    store.mutate((db) => {
      db.lighting = state
    })
    context.onLightingChanged(state)
    return lightingStatus()
  })

  // ---- Drivers ------------------------------------------------------------
  handle<DriverReport | null>(CHANNELS.driversLast, () => store.snapshot.lastDriverReport)

  handle<DriverReport>(CHANNELS.driversCheck, async () => {
    const report = await checkDrivers(logger)
    return store.mutate((db) => {
      db.lastDriverReport = report
      return report
    })
  })

  // ---- Shell --------------------------------------------------------------
  handle<{ opened: boolean }>(CHANNELS.shellOpenExternal, async (url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Invalid URL')
    }
    if (parsed.protocol !== 'https:') throw new Error('Only https links may be opened.')
    await shell.openExternal(parsed.toString())
    return { opened: true }
  })

  return handlers
}
