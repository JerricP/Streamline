import { execFile } from 'node:child_process'
import { devicesAsync, HIDAsync } from 'node-hid'
import type { Device } from 'node-hid'
import type { AuraDeviceInfo, LightingMode, LightingState } from '@shared/types'
import type { Logger } from './logger'

/**
 * Talks to the ASUS Aura USB lighting controller found on recent ASUS
 * mainboards (the ROG Strix B850-I among them, PID 0x19AF), so lighting works without
 * Armoury Crate.
 *
 * Armoury Crate drives this controller from its MB HAL
 * (`Aac3572MbHal_x64.exe`), which opens it as a plain USB HID device under the
 * `Global\asusaurausb` mutex. The packet layout below is the community-documented
 * Aura USB protocol (65-byte reports, report id 0xEC). It is reimplemented
 * here; no ASUS code is used.
 */

const ASUS_VENDOR_ID = 0x0b05
/** Vendor-defined usage page the Aura controller exposes its reports on. */
const AURA_USAGE_PAGE = 0xff72
const REPORT_ID = 0xec
const REPORT_LENGTH = 65

const CMD_FIRMWARE = 0x82
const CMD_CONFIG_TABLE = 0xb0
const CMD_EFFECT = 0x35
const CMD_COLOR = 0x36
const CMD_COMMIT = 0x3f

/** Config table offsets, relative to the start of the table. */
const CONFIG_ARGB_HEADERS = 0x02
const CONFIG_MAINBOARD_LEDS = 0x1b

/** Effect channel 0 is the onboard LEDs; ARGB headers follow from 1. */
const MAINBOARD_CHANNEL = 0x00

/** Highest LED slot one colour packet can address (a 16-bit mask). */
const MAX_SLOTS = 16

const MODE_IDS: Record<LightingMode, number> = {
  off: 0x00,
  static: 0x01,
  breathing: 0x02,
  flashing: 0x03,
  spectrum: 0x04,
  rainbow: 0x05
}

// ---- Packet builders (pure, no I/O) ---------------------------------------

function report(...bytes: number[]): number[] {
  const buffer = new Array<number>(REPORT_LENGTH).fill(0)
  buffer[0] = REPORT_ID
  bytes.forEach((value, index) => {
    buffer[index + 1] = value & 0xff
  })
  return buffer
}

export function firmwarePacket(): number[] {
  return report(CMD_FIRMWARE)
}

export function configTablePacket(): number[] {
  return report(CMD_CONFIG_TABLE)
}

export function effectPacket(channel: number, mode: LightingMode): number[] {
  return report(CMD_EFFECT, channel, 0x00, 0x00, MODE_IDS[mode])
}

/** Colour `count` consecutive LED slots starting at `start` with one RGB value. */
export function colorPacket(start: number, count: number, rgb: [number, number, number]): number[] {
  const first = Math.max(0, Math.min(start, MAX_SLOTS))
  const last = Math.max(first, Math.min(start + count, MAX_SLOTS))
  const mask = last > first ? ((1 << (last - first)) - 1) << first : 0
  const buffer = report(CMD_COLOR, (mask >> 8) & 0xff, mask & 0xff, 0x00)
  for (let slot = first; slot < last; slot += 1) {
    const offset = 5 + slot * 3
    buffer[offset] = rgb[0]
    buffer[offset + 1] = rgb[1]
    buffer[offset + 2] = rgb[2]
  }
  return buffer
}

export function commitPacket(): number[] {
  return report(CMD_COMMIT, 0x55)
}

export function parseHexColor(value: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) throw new Error(`Not a #rrggbb colour: ${value}`)
  const hex = parseInt(match[1], 16)
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff]
}

export interface AuraConfig {
  mainboardLeds: number
  argbHeaders: number
}

/** Read the LED counts out of a config-table response, or null if it isn't one. */
export function parseConfigResponse(response: ArrayLike<number>): { config: AuraConfig; table: number[] } | null {
  // Responses come back without the report id: [0]=0xEC echo is stripped by
  // some stacks and kept by others, so look for the 0x30 marker at 0 or 1.
  const bytes = Array.from(response)
  const marker = bytes[0] === 0x30 ? 0 : bytes[1] === 0x30 ? 1 : -1
  if (marker < 0) return null
  const table = bytes.slice(marker + 3, marker + 3 + 60)
  if (table.length < CONFIG_MAINBOARD_LEDS + 1) return null
  return {
    config: {
      mainboardLeds: Math.min(table[CONFIG_MAINBOARD_LEDS], MAX_SLOTS),
      argbHeaders: Math.min(table[CONFIG_ARGB_HEADERS], 8)
    },
    table
  }
}

export function parseFirmwareResponse(response: ArrayLike<number>): string | null {
  const bytes = Array.from(response)
  const marker = bytes[0] === 0x02 ? 0 : bytes[1] === 0x02 ? 1 : -1
  if (marker < 0) return null
  const text = String.fromCharCode(...bytes.slice(marker + 1, marker + 17).filter((byte) => byte >= 0x20 && byte < 0x7f))
  return text.trim() || null
}

/** Every packet needed to put a board into `state`, in send order. */
export function packetsForState(state: LightingState, config: AuraConfig): number[][] {
  const rgb = parseHexColor(state.color)
  const packets: number[][] = []

  packets.push(effectPacket(MAINBOARD_CHANNEL, state.mode))
  if (config.mainboardLeds > 0) packets.push(colorPacket(0, config.mainboardLeds, rgb))

  if (state.includeHeaders) {
    for (let header = 0; header < config.argbHeaders; header += 1) {
      packets.push(effectPacket(MAINBOARD_CHANNEL + 1 + header, state.mode))
    }
    // In effect mode each header takes one colour slot after the onboard LEDs.
    if (config.argbHeaders > 0) packets.push(colorPacket(config.mainboardLeds, config.argbHeaders, rgb))
  }

  packets.push(commitPacket())
  return packets
}

// ---- Device access --------------------------------------------------------

function isAuraController(device: Device): boolean {
  return device.vendorId === ASUS_VENDOR_ID && device.usagePage === AURA_USAGE_PAGE && Boolean(device.path)
}

async function request(hid: HIDAsync, packet: number[]): Promise<number[] | null> {
  await hid.write(packet)
  const response = await hid.read(500)
  return response && response.length > 0 ? Array.from(response) : null
}

async function describe(device: Device, logger: Logger): Promise<{ info: AuraDeviceInfo; config: AuraConfig }> {
  const hid = await HIDAsync.open(device.path as string, { nonExclusive: true })
  try {
    let firmware: string | null = null
    try {
      const response = await request(hid, firmwarePacket())
      firmware = response ? parseFirmwareResponse(response) : null
    } catch (error) {
      logger.warn('aura', `Firmware query failed: ${String(error)}`)
    }

    let parsed: ReturnType<typeof parseConfigResponse> = null
    try {
      const response = await request(hid, configTablePacket())
      parsed = response ? parseConfigResponse(response) : null
    } catch (error) {
      logger.warn('aura', `Config table query failed: ${String(error)}`)
    }

    // Fall back to a conservative layout so the board still gets a colour.
    const config = parsed?.config ?? { mainboardLeds: 1, argbHeaders: 0 }
    return {
      config,
      info: {
        path: device.path as string,
        product: device.product ?? 'ASUS Aura controller',
        productId: `0x${device.productId.toString(16).padStart(4, '0')}`,
        firmware,
        mainboardLeds: config.mainboardLeds,
        argbHeaders: config.argbHeaders,
        configTable: parsed ? parsed.table.map((byte) => byte.toString(16).padStart(2, '0')).join(' ') : null
      }
    }
  } finally {
    await hid.close()
  }
}

export class AuraService {
  /** Device I/O is serialised so two IPC calls never interleave packets. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly logger: Logger

  // A plain field rather than a parameter property, so `node --test` can strip the types.
  constructor(logger: Logger) {
    this.logger = logger
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async controllers(): Promise<Device[]> {
    const all = await devicesAsync()
    return all.filter(isAuraController)
  }

  list(): Promise<AuraDeviceInfo[]> {
    return this.serial(async () => {
      const found: AuraDeviceInfo[] = []
      for (const device of await this.controllers()) {
        try {
          found.push((await describe(device, this.logger)).info)
        } catch (error) {
          this.logger.warn('aura', `Could not open ${device.path}: ${String(error)}`)
        }
      }
      return found
    })
  }

  apply(state: LightingState): Promise<number> {
    return this.serial(async () => {
      const devices = await this.controllers()
      if (devices.length === 0) throw new Error('No ASUS Aura lighting controller was found.')

      let applied = 0
      for (const device of devices) {
        const { config } = await describe(device, this.logger)
        const hid = await HIDAsync.open(device.path as string, { nonExclusive: true })
        try {
          for (const packet of packetsForState(state, config)) await hid.write(packet)
          applied += 1
        } finally {
          await hid.close()
        }
      }
      this.logger.info('aura', `Applied ${state.mode} ${state.color} to ${applied} controller(s)`)
      return applied
    })
  }
}

/** Armoury Crate's lighting service; it rewrites the controller while it runs. */
const VENDOR_LIGHTING_SERVICE = 'LightingService'

export function isVendorLightingServiceRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', VENDOR_LIGHTING_SERVICE], { windowsHide: true }, (error, stdout) => {
      resolve(!error && /STATE\s*:\s*\d+\s+RUNNING/i.test(stdout))
    })
  })
}
