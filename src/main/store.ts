import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DriverReport, FanChannelConfig, LightingState, Settings } from '@shared/types'
import type { ChipPoint } from './services/fanCurves'
import type { Paths } from './services/paths'

export interface Database {
  schemaVersion: number
  settings: Settings
  /** The lighting last applied, re-applied on start-up. */
  lighting: LightingState | null
  lastDriverReport: DriverReport | null
  /** Turned on from the Overview page; starts the sensor helper at launch. */
  monitoringEnabled: boolean
  /** Fan settings keyed by control sensor id. */
  fans: Record<string, FanChannelConfig>
  /** NCT6701D headers' own curves from before Streamline first rewrote them; BIOS mode restores these. */
  chipOriginals: Record<string, ChipPoint[]>
}

const SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: '#7c5cff',
  startWithWindows: true
}

function emptyDatabase(): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    lighting: null,
    lastDriverReport: null,
    monitoringEnabled: false,
    fans: {},
    chipOriginals: {}
  }
}

/**
 * JSON-backed persistence with atomic writes. The dataset is tiny, so a single
 * document is simpler and safer than a native database dependency.
 */
export class Store {
  private data: Database
  private flushTimer: NodeJS.Timeout | null = null

  constructor(private readonly paths: Paths) {
    this.data = this.read()
  }

  private read(): Database {
    try {
      if (!existsSync(this.paths.db)) return emptyDatabase()
      const parsed = JSON.parse(readFileSync(this.paths.db, 'utf8')) as Partial<Database>
      return {
        schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
        // Merge so newly added settings keys always get a default.
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        lighting: parsed.lighting ?? null,
        lastDriverReport: parsed.lastDriverReport ?? null,
        monitoringEnabled: parsed.monitoringEnabled === true,
        fans: parsed.fans ?? {},
        chipOriginals: parsed.chipOriginals ?? {}
      }
    } catch {
      return emptyDatabase()
    }
  }

  get snapshot(): Database {
    return this.data
  }

  get settings(): Settings {
    return this.data.settings
  }

  /** Mutate then persist; the flush is debounced and atomic. */
  mutate<T>(fn: (db: Database) => T): T {
    const result = fn(this.data)
    this.flush()
    return result
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => this.flushNow(), 150)
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    const target = this.paths.db
    const tmp = `${target}.tmp`
    try {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, target)
    } catch {
      // Persisting is best effort; a failed write leaves the previous db intact.
    }
  }
}
