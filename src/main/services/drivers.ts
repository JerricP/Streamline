import { execFile } from 'node:child_process'
import { release } from 'node:os'
import type { DriverItem, DriverReport, DriverStatus } from '@shared/types'
import type { Logger } from './logger'

/**
 * Driver update checks for the mainboard, replacing ASUS DriverHub.
 *
 * DriverHub is a thin window onto driverhub.asus.com backed by a local agent
 * (`ADU.exe`) that serves the site over a 127.0.0.1 websocket. Streamline skips the
 * agent entirely: it reads the installed versions from Windows itself and asks
 * ASUS's public support catalogue what is current for this board.
 */

const ROG_HOST = 'https://rog.asus.com'

/** ASUS support-site OS ids. */
const OS_WINDOWS_11_64 = { id: '52', label: 'Windows 11 64-bit' }
const OS_WINDOWS_10_64 = { id: '45', label: 'Windows 10 64-bit' }

const KNOWN_VENDORS = ['amd', 'intel', 'realtek', 'mediatek', 'nvidia', 'qualcomm', 'asmedia', 'marvell']

/** Other spellings vendors use in driver names and catalogue titles. */
const VENDOR_ALIASES: Array<[RegExp, string]> = [
  [/advanced micro devices/gi, 'amd'],
  [/\bmtk\b/gi, 'mediatek']
]

/** Words that tell an installed driver's kind apart; matched against both sides. */
const KIND_KEYWORDS: Record<string, RegExp> = {
  chipset: /chipset/i,
  audio: /audio|sound/i,
  lan: /\blan\b|ethernet|network|2\.5g|gbe/i,
  wireless: /wi-?fi|wireless|wlan|802\.11/i,
  bluetooth: /bluetooth/i,
  raid: /raid/i,
  graphics: /graphics|vga|display/i,
  npu: /\bnpu\b|\bipu\b|ryzen ai/i
}

// ---- Installed inventory --------------------------------------------------

export interface InstalledEntry {
  name: string
  version: string
}

export interface SystemInventory {
  boardManufacturer: string
  board: string
  biosVersion: string | null
  entries: InstalledEntry[]
}

/**
 * One PowerShell round trip: board + BIOS from SMBIOS, signed device drivers,
 * and installed programs (chipset and audio packages register as programs).
 */
const INVENTORY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1
$drivers = Get-CimInstance Win32_PnPSignedDriver |
  Where-Object { $_.DeviceName -and $_.DriverVersion } |
  ForEach-Object { @{ name = "$($_.Manufacturer) $($_.DeviceName)"; version = $_.DriverVersion } }
$apps = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
  Where-Object { $_.DisplayName -and $_.DisplayVersion } |
  ForEach-Object { @{ name = "$($_.Publisher) $($_.DisplayName)"; version = $_.DisplayVersion } }
@{
  boardManufacturer = $board.Manufacturer
  board = $board.Product
  biosVersion = $bios.SMBIOSBIOSVersion
  entries = @($drivers) + @($apps)
} | ConvertTo-Json -Depth 4 -Compress
`

export function readInventory(): Promise<SystemInventory> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Driver checks are only available on Windows.'))
  }
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', INVENTORY_SCRIPT],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 },
      (error, stdout) => {
        if (error) return reject(new Error(`Could not read installed drivers: ${error.message}`))
        try {
          const raw = JSON.parse(stdout) as Partial<SystemInventory>
          resolve({
            boardManufacturer: String(raw.boardManufacturer ?? ''),
            board: String(raw.board ?? '').trim(),
            biosVersion: raw.biosVersion ? String(raw.biosVersion).trim() : null,
            entries: (raw.entries ?? [])
              .filter((entry) => entry && entry.name && entry.version)
              .map((entry) => ({ name: String(entry.name).trim(), version: String(entry.version).trim() }))
          })
        } catch (parseError) {
          reject(new Error(`Unexpected inventory output: ${String(parseError)}`))
        }
      }
    )
  })
}

// ---- ASUS catalogue -------------------------------------------------------

interface CatalogFile {
  Title?: string
  Version?: string
  IsRelease?: string | number
  ReleaseDate?: string
  FileSize?: string
  DownloadUrl?: { Global?: string } | null
}

interface CatalogGroup {
  Name?: string
  Files?: CatalogFile[]
}

interface CatalogResponse {
  Status?: string
  Result?: { Obj?: CatalogGroup[] } | null
}

export interface CatalogEntry {
  category: string
  title: string
  version: string
  releaseDate: string
  size: string
  downloadUrl: string | null
}

/** "ROG STRIX B850-I GAMING WIFI" -> "ROG-STRIX-B850-I-GAMING-WIFI", the support-site model key. */
export function modelKey(board: string): string {
  return board.trim().replace(/\s+/g, '-')
}

export function currentOs(): { id: string; label: string } {
  const build = Number(release().split('.')[2] ?? 0)
  return build >= 22000 ? OS_WINDOWS_11_64 : OS_WINDOWS_10_64
}

/**
 * What a package is, without its version and OS suffix, so re-uploads and
 * renamed copies collapse: "MTK Bluetooth V1.1038.0.442 for Windows 11
 * 64-bit.(WHQL)" and "Bluetooth driver v1.1038.0.442 for Windows 11 64-bit."
 * both become "bluetooth".
 */
export function packageName(title: string): string {
  return normalizeVendors(title)
    .replace(/\bfor windows.*$/, '')
    .replace(/\(whql\)/g, '')
    .replace(/\bv?\d+(\.\d+)+\b/g, '')
    .replace(/\b(driver|drivers|mediatek|realtek|intel|amd|software|package)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Newer by release date; version only breaks ties, since schemes differ between uploads. */
function isNewer(candidate: CatalogEntry, existing: CatalogEntry): boolean {
  const byDate = candidate.releaseDate.localeCompare(existing.releaseDate)
  return byDate !== 0 ? byDate > 0 : compareVersions(candidate.version, existing.version) > 0
}

/**
 * Flatten a catalogue response, keeping only the newest released file per
 * title. BIOS files come with an empty Title, so they share one slot.
 */
export function parseCatalog(response: CatalogResponse, fallbackCategory: string): CatalogEntry[] {
  const groups = response.Result?.Obj ?? []
  const newest = new Map<string, CatalogEntry>()
  for (const group of groups) {
    const category = group.Name?.trim() || fallbackCategory
    for (const file of group.Files ?? []) {
      // IsRelease "0" marks beta builds, which ASUS lists but doesn't recommend.
      if (!file.Version || String(file.IsRelease ?? '1') === '0') continue
      const rawTitle = (file.Title ?? '').trim()
      const entry: CatalogEntry = {
        category,
        title: rawTitle || `${category} ${file.Version.trim()}`,
        version: file.Version.trim(),
        releaseDate: (file.ReleaseDate ?? '').trim(),
        size: (file.FileSize ?? '').trim(),
        downloadUrl: file.DownloadUrl?.Global?.trim() || null
      }
      const key = `${category}|${packageName(rawTitle)}`
      const existing = newest.get(key)
      if (!existing || isNewer(entry, existing)) newest.set(key, entry)
    }
  }
  return [...newest.values()]
}

async function fetchJson(url: string): Promise<CatalogResponse> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as CatalogResponse
}

/** Driver list for the board and OS, from the ROG support site. */
function driversUrl(board: string, osId: string): string {
  const model = encodeURIComponent(modelKey(board))
  return `${ROG_HOST}/support/webapi/product/GetPDDrivers?website=global&model=${model}&pdid=&cpu=&osid=${osId}`
}

/** BIOS list for the board. It answers 404 unless the (empty) `cpu` parameter is present. */
function biosUrl(board: string): string {
  const model = encodeURIComponent(modelKey(board))
  return `${ROG_HOST}/support/webapi/product/GetPDBIOS?website=global&model=${model}&pdid=&cpu=`
}

export interface Catalog {
  entries: CatalogEntry[]
  /** Set when the BIOS list couldn't be loaded; drivers are still reported. */
  biosError: string | null
}

export async function fetchCatalog(board: string, osId: string, logger: Logger): Promise<Catalog> {
  let drivers: CatalogEntry[]
  try {
    drivers = parseCatalog(await fetchJson(driversUrl(board, osId)), 'Drivers')
  } catch (error) {
    throw new Error(`Could not load the ASUS driver list: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (drivers.length === 0) throw new Error(`ASUS lists no drivers for ${board}.`)

  // BIOS is optional: a failure here shouldn't hide driver updates.
  try {
    const bios = parseCatalog(await fetchJson(biosUrl(board)), 'BIOS')
    if (bios.length === 0) return { entries: drivers, biosError: 'ASUS returned no BIOS list.' }
    return { entries: [...bios, ...drivers], biosError: null }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.warn('drivers', `BIOS list failed: ${reason}`)
    return { entries: drivers, biosError: `Couldn't load the BIOS list (${reason}).` }
  }
}

// ---- Comparison -----------------------------------------------------------

function versionParts(version: string): number[] {
  return (version.match(/\d+/g) ?? []).map(Number)
}

/** Numeric, segment-wise compare; "V2.07.1" vs "2.7.1" are equal. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

function kindsOf(text: string): string[] {
  return Object.entries(KIND_KEYWORDS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind)
}

function normalizeVendors(text: string): string {
  return VENDOR_ALIASES.reduce((value, [pattern, vendor]) => value.replace(pattern, vendor), text.toLowerCase())
}

function vendorsOf(text: string): string[] {
  const lower = normalizeVendors(text)
  return KNOWN_VENDORS.filter((vendor) => lower.includes(vendor))
}

/**
 * Find what is installed for one catalogue entry. An exact version match wins;
 * otherwise the newest installed entry sharing both a vendor and a kind.
 */
export function matchInstalled(entry: CatalogEntry, inventory: SystemInventory): string | null {
  if (/bios/i.test(entry.category)) return inventory.biosVersion

  // The title says what the package is; ASUS's category is broad (NPU drivers
  // sit under "Chipset"), so it only decides the kind when the title can't.
  const vendors = vendorsOf(`${entry.category} ${entry.title}`)
  const titleKinds = kindsOf(entry.title)
  const kinds = titleKinds.length > 0 ? titleKinds : kindsOf(entry.category)
  const sharesVendor = (name: string) => vendors.some((vendor) => normalizeVendors(name).includes(vendor))
  const sharesKind = (name: string) => kinds.some((kind) => KIND_KEYWORDS[kind].test(name))

  // Short versions like "1.0.0" collide across unrelated software, so an exact
  // match still has to look related.
  const wanted = versionParts(entry.version).join('.')
  const exact = inventory.entries.find(
    (installed) =>
      versionParts(installed.version).join('.') === wanted && (sharesVendor(installed.name) || sharesKind(installed.name))
  )
  if (exact && wanted.length > 0) return exact.version

  if (vendors.length === 0 || kinds.length === 0) return null
  const candidates = inventory.entries.filter((installed) => sharesVendor(installed.name) && sharesKind(installed.name))
  if (candidates.length === 0) return null
  candidates.sort((a, b) => compareVersions(b.version, a.version))
  return candidates[0].version
}

export function statusFor(latest: string, installed: string | null): DriverStatus {
  if (!installed) return 'unknown'
  return compareVersions(installed, latest) >= 0 ? 'up-to-date' : 'update-available'
}

export function buildReport(
  inventory: SystemInventory,
  catalog: CatalogEntry[],
  osLabel: string,
  biosError: string | null = null
): DriverReport {
  const items: DriverItem[] = catalog.map((entry) => {
    const installedVersion = matchInstalled(entry, inventory)
    return {
      category: entry.category,
      title: entry.title,
      latestVersion: entry.version,
      releaseDate: entry.releaseDate,
      size: entry.size,
      downloadUrl: entry.downloadUrl,
      installedVersion,
      status: statusFor(entry.version, installedVersion)
    }
  })

  const rank: Record<DriverStatus, number> = { 'update-available': 0, unknown: 1, 'up-to-date': 2 }
  items.sort((a, b) => rank[a.status] - rank[b.status] || a.category.localeCompare(b.category))

  return {
    checkedAt: Date.now(),
    board: inventory.board,
    biosVersion: inventory.biosVersion,
    os: osLabel,
    items,
    biosError
  }
}

export async function checkDrivers(logger: Logger): Promise<DriverReport> {
  const inventory = await readInventory()
  if (!/asus/i.test(inventory.boardManufacturer) || !inventory.board) {
    throw new Error('This check only supports ASUS mainboards.')
  }
  const os = currentOs()
  const catalog = await fetchCatalog(inventory.board, os.id, logger)
  const report = buildReport(inventory, catalog.entries, os.label, catalog.biosError)
  const updates = report.items.filter((item) => item.status === 'update-available').length
  logger.info('drivers', `${inventory.board}: ${report.items.length} packages, ${updates} update(s)`)
  return report
}
