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

// ---- Sensors and fans -----------------------------------------------------

/** LibreHardwareMonitor's sensor kinds, e.g. "Temperature", "Fan", "Control". */
export type SensorType = string

export interface SensorReading {
  /** Stable LibreHardwareMonitor identifier, e.g. "/lpc/nct6701d/0/fan/1". */
  id: string
  name: string
  type: SensorType
  value: number | null
  min: number | null
  max: number | null
  /** Controls only: Streamline (not the BIOS) currently sets this fan. */
  software: boolean
}

export interface HardwareReading {
  id: string
  /** Sub-hardware is flattened; its name is prefixed with the parent's. */
  name: string
  /** LibreHardwareMonitor's hardware kind, e.g. "Cpu", "SuperIO", "GpuNvidia". */
  type: string
  sensors: SensorReading[]
}

export interface SensorSnapshot {
  at: number
  hardware: HardwareReading[]
}

export type MonitorState = 'off' | 'starting' | 'running' | 'error'

export interface MonitorStatus {
  state: MonitorState
  /** Why monitoring stopped or isn't fully working, in plain words. */
  message: string | null
  /** The PawnIO driver LibreHardwareMonitor needs for the Super I/O chip. Null until known. */
  driverInstalled: boolean | null
  /** Readings come from the built-in simulator, not real hardware (development only). */
  simulated: boolean
  /** Armoury Crate's fan service is running and will fight over the fans. */
  vendorFanServiceRunning: boolean
}

export interface FanCurvePoint {
  /** °C */
  temp: number
  /** Percent, 0-100. */
  duty: number
}

/** `bios`: the board's own Q-Fan control. `fixed`: one speed. `curve`: follow a temperature. */
export type FanMode = 'bios' | 'fixed' | 'curve'

export interface FanChannelConfig {
  mode: FanMode
  fixedDuty: number
  /** Temperature sensor the curve follows. */
  sourceId: string | null
  points: FanCurvePoint[]
}

export interface FanChannel {
  /** The control sensor's id; fan settings are keyed by it. */
  controlId: string
  /** The matching RPM sensor, when the chip reports one. */
  fanId: string | null
  name: string
  rpm: number | null
  /** Duty the chip reports now, percent. */
  duty: number | null
  /** Duty Streamline last asked for, or null while the BIOS is in charge. */
  target: number | null
  /** The curve's temperature right now. */
  sourceTemp: number | null
  config: FanChannelConfig
}

export interface TemperatureSource {
  id: string
  name: string
  hardware: string
  value: number | null
}

export interface FansStatus {
  monitor: MonitorStatus
  channels: FanChannel[]
  temperatures: TemperatureSource[]
}

export interface SensorsStatus {
  monitor: MonitorStatus
  snapshot: SensorSnapshot | null
}
