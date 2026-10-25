/**
 * Shared domain types for Streamline.
 *
 * These types are the single source of truth for the main process and the
 * web UI. Nothing here references Electron so the same file can be compiled
 * for both the node and the web tsconfig.
 */

export type ThemePreference = 'dark' | 'light' | 'system'

export interface Settings {
  theme: ThemePreference
  accent: string
  /** Launch Streamline in the tray when Windows starts. */
  startWithWindows: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  dataDir: string
}

// ---- Hardware -------------------------------------------------------------

/** Effects the ASUS Aura USB controller runs on its own, without the app. */
export type LightingMode = 'off' | 'static' | 'breathing' | 'flashing' | 'spectrum' | 'rainbow'

export interface LightingState {
  mode: LightingMode
  /** `#rrggbb`; ignored by modes that pick their own colours. */
  color: string
  /** Also drive the addressable (ARGB) headers, not just the onboard LEDs. */
  includeHeaders: boolean
}

export interface AuraDeviceInfo {
  /** OS device path; stable for a session, not across reboots. */
  path: string
  product: string
  productId: string
  firmware: string | null
  mainboardLeds: number
  argbHeaders: number
  /** Raw config table as hex, for diagnosing unfamiliar boards. */
  configTable: string | null
}

export interface LightingStatus {
  devices: AuraDeviceInfo[]
  /**
   * True while Armoury Crate's lighting service is running. It writes to the
   * same controller and will overwrite whatever Streamline sets.
   */
  vendorServiceRunning: boolean
  saved: LightingState | null
}

export type DriverStatus = 'up-to-date' | 'update-available' | 'unknown'

export interface DriverItem {
  category: string
  title: string
  latestVersion: string
  releaseDate: string
  size: string
  downloadUrl: string | null
  installedVersion: string | null
  status: DriverStatus
}

export interface DriverReport {
  checkedAt: number
  /** Board model as reported by SMBIOS, e.g. "ROG STRIX B850-I GAMING WIFI". */
  board: string
  biosVersion: string | null
  os: string
  items: DriverItem[]
  /** Why the BIOS list is missing, when it is; drivers are still listed. */
  biosError: string | null
}
