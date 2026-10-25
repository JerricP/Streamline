import type {
  AppInfo,
  DriverReport,
  FanChannelConfig,
  FansStatus,
  LightingState,
  LightingStatus,
  SensorsStatus,
  Settings
} from './types'
import { CHANNELS } from './channels'

/**
 * Everything the web UI can ask of the main process. The UI runs in the
 * user's browser and reaches these over the local web server.
 */
export interface StreamlineApi {
  app: {
    info(): Promise<AppInfo>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
  }
  lighting: {
    status(): Promise<LightingStatus>
    apply(state: LightingState): Promise<LightingStatus>
  }
  drivers: {
    last(): Promise<DriverReport | null>
    check(): Promise<DriverReport>
  }
  shell: {
    openExternal(url: string): Promise<{ opened: boolean }>
  }
  sensors: {
    status(): Promise<SensorsStatus>
    /** Turn hardware monitoring on; Windows asks for administrator rights. */
    start(): Promise<SensorsStatus>
    stop(): Promise<SensorsStatus>
  }
  fans: {
    status(): Promise<FansStatus>
    save(controlId: string, config: FanChannelConfig): Promise<FansStatus>
  }
}

/** Sends one request to the main process and unwraps its result envelope. */
export type Invoke = <T>(channel: string, ...args: unknown[]) => Promise<T>

/** Results from the main process arrive wrapped so errors survive transport. */
export interface Envelope<T> {
  ok: boolean
  value?: T
  error?: string
}

export function unwrap<T>(channel: string, envelope: Envelope<T> | undefined): T {
  if (!envelope || !envelope.ok) {
    throw new Error(envelope?.error ?? `Request to "${channel}" failed`)
  }
  return envelope.value as T
}

export function createApi(invoke: Invoke): StreamlineApi {
  return {
    app: {
      info: () => invoke<AppInfo>(CHANNELS.appInfo)
    },
    settings: {
      get: () => invoke<Settings>(CHANNELS.settingsGet),
      update: (patch) => invoke<Settings>(CHANNELS.settingsUpdate, patch)
    },
    lighting: {
      status: () => invoke<LightingStatus>(CHANNELS.lightingStatus),
      apply: (state) => invoke<LightingStatus>(CHANNELS.lightingApply, state)
    },
    drivers: {
      last: () => invoke<DriverReport | null>(CHANNELS.driversLast),
      check: () => invoke<DriverReport>(CHANNELS.driversCheck)
    },
    shell: {
      openExternal: (url) => invoke<{ opened: boolean }>(CHANNELS.shellOpenExternal, url)
    },
    sensors: {
      status: () => invoke<SensorsStatus>(CHANNELS.sensorsStatus),
      start: () => invoke<SensorsStatus>(CHANNELS.sensorsStart),
      stop: () => invoke<SensorsStatus>(CHANNELS.sensorsStop)
    },
    fans: {
      status: () => invoke<FansStatus>(CHANNELS.fansStatus),
      save: (controlId, config) => invoke<FansStatus>(CHANNELS.fansSave, controlId, config)
    }
  }
}
