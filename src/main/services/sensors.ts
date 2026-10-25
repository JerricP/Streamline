import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import { join } from 'node:path'
import type {
  FanChannelConfig,
  HardwareReading,
  MonitorStatus,
  SensorSnapshot
} from '@shared/types'
import {
  canSetDuty,
  checkStall,
  chipCurveDuty,
  chipCurvePoints,
  fanIdForControl,
  findSensor,
  preferredSource,
  sameChipCurve,
  targetDuty,
  usesChipCurve
} from './fanCurves'
import type { ChipPoint, StallState } from './fanCurves'
import { SimulatedBackend } from './sensorSimulator'
import type { Logger } from './logger'

/**
 * Hardware monitoring and fan control.
 *
 * On this board family the fan headers and most temperatures live on a
 * Nuvoton Super I/O chip (NCT6701D on the ROG Strix B850-I) that is only
 * reachable through I/O ports, so it needs a kernel driver. Streamline doesn't
 * ship one: it uses LibreHardwareMonitorLib, which talks to the chip through
 * the signed PawnIO driver, from a small PowerShell helper running elevated.
 * See docs/RESEARCH.md.
 */

const TICK_MS = 1000
/** Long enough to answer a UAC prompt. */
const HELLO_TIMEOUT_MS = 90_000
const REQUEST_TIMEOUT_MS = 15_000

/** Armoury Crate's fan service; it rewrites fan duty while it runs. */
const VENDOR_FAN_SERVICE = 'AsusFanControlService'

export interface SensorBackend {
  readonly driverInstalled: boolean | null
  read(): Promise<HardwareReading[]>
  set(controlId: string, duty: number): Promise<void>
  /** Hand the fan back to the BIOS. */
  restore(controlId: string): Promise<void>
  /** NCT6701D only: the header's own 10-point curve (see usesChipCurve). */
  readChipCurve(controlId: string): Promise<ChipPoint[]>
  writeChipCurve(controlId: string, points: ChipPoint[]): Promise<ChipPoint[]>
  close(): void
  onExit(listener: (reason: string) => void): void
}

export interface HelperPaths {
  script: string
  libDir: string
}

// ---- The elevated PowerShell helper ---------------------------------------

interface HelperMessage {
  type?: string
  id?: number | null
  ok?: boolean
  error?: string
  token?: string
  elevated?: boolean
  driverInstalled?: boolean
  hardware?: HardwareReading[]
  curve?: { mode: number; engine: number; points: ChipPoint[] }
}

function isElevated(): Promise<boolean> {
  // `net session` only succeeds for administrators.
  return new Promise((resolve) => {
    execFile('net.exe', ['session'], { windowsHide: true }, (error) => resolve(!error))
  })
}

/** Quote for a PowerShell single-quoted string. */
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`

class HelperBackend implements SensorBackend {
  private nextId = 1
  private buffer = ''
  private readonly pending = new Map<number, { resolve: (message: HelperMessage) => void; reject: (error: Error) => void }>()
  private readonly exitListeners: Array<(reason: string) => void> = []
  private closed = false
  readonly driverInstalled: boolean | null
  private readonly socket: Socket
  private readonly server: Server

  constructor(server: Server, socket: Socket, hello: HelperMessage, leftover: string) {
    this.server = server
    this.socket = socket
    this.driverInstalled = hello.driverInstalled ?? null
    this.buffer = leftover
    socket.on('data', (chunk: Buffer) => this.onData(chunk.toString('utf8')))
    socket.on('close', () => this.shutdown('The sensor helper stopped.'))
    socket.on('error', () => this.shutdown('The sensor helper connection failed.'))
  }

  static async launch(paths: HelperPaths, logger: Logger): Promise<HelperBackend> {
    if (!existsSync(paths.script) || !existsSync(join(paths.libDir, 'LibreHardwareMonitorLib.dll'))) {
      throw new Error('The sensor helper files are missing. Rebuild with `npm run fetch:lhm`.')
    }
    const pipeName = `streamline-sensors-${randomBytes(12).toString('hex')}`
    const token = randomBytes(24).toString('hex')
    const helperArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      paths.script,
      '-LibDir',
      paths.libDir,
      '-Pipe',
      pipeName,
      '-Token',
      token
    ]

    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(`\\\\.\\pipe\\${pipeName}`, () => resolve())
    })

    const connection = new Promise<{ socket: Socket; hello: HelperMessage; leftover: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The sensor helper did not start in time.')), HELLO_TIMEOUT_MS)
      server.on('connection', (socket) => {
        let text = ''
        const onData = (chunk: Buffer) => {
          text += chunk.toString('utf8')
          const newline = text.indexOf('\n')
          if (newline < 0) return
          socket.off('data', onData)
          let hello: HelperMessage = {}
          try {
            hello = JSON.parse(text.slice(0, newline)) as HelperMessage
          } catch {
            // Treated as a stranger below.
          }
          if (hello.type === 'fatal') {
            clearTimeout(timer)
            reject(new Error(`The sensor helper failed: ${hello.error ?? 'unknown error'}`))
            return
          }
          // Only the helper we launched knows the token; drop anyone else.
          if (hello.type !== 'hello' || hello.token !== token) {
            socket.destroy()
            return
          }
          clearTimeout(timer)
          resolve({ socket, hello, leftover: text.slice(newline + 1) })
        }
        socket.on('data', onData)
      })
    })

    const elevated = await isElevated()
    const child = elevated
      ? spawn('powershell.exe', helperArgs, { windowsHide: true, stdio: 'ignore' })
      : // Start-Process -Verb RunAs shows the UAC prompt and starts the helper elevated.
        spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList ${psQuote(
              helperArgs.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg)).join(' ')
            )}`
          ],
          { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
        )
    logger.info('sensors', `Starting sensor helper (${elevated ? 'already elevated' : 'asking for administrator rights'})`)

    const launchFailed = new Promise<never>((_, reject) => {
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
      child.on('error', (error) => reject(new Error(`Could not start PowerShell: ${error.message}`)))
      child.on('exit', (code) => {
        if (elevated || code === 0) return
        reject(
          new Error(
            /cancel/i.test(stderr)
              ? 'Administrator rights were declined, so sensors and fans stay off.'
              : `The sensor helper could not be started: ${stderr.trim() || `exit code ${code}`}`
          )
        )
      })
    })

    try {
      const { socket, hello, leftover } = await Promise.race([connection, launchFailed])
      if (!hello.elevated) logger.warn('sensors', 'Sensor helper is not elevated; the Super I/O chip will be missing')
      return new HelperBackend(server, socket, hello, leftover)
    } catch (error) {
      server.close()
      if (elevated && !child.killed) child.kill()
      throw error
    }
  }

  private onData(text: string): void {
    this.buffer += text
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      newline = this.buffer.indexOf('\n')
      if (!line) continue
      let message: HelperMessage
      try {
        message = JSON.parse(line) as HelperMessage
      } catch {
        continue
      }
      if (message.type === 'fatal') {
        this.shutdown(`The sensor helper failed: ${message.error ?? 'unknown error'}`)
        return
      }
      const waiter = typeof message.id === 'number' ? this.pending.get(message.id) : undefined
      if (!waiter) continue
      this.pending.delete(message.id as number)
      if (message.ok) waiter.resolve(message)
      else waiter.reject(new Error(message.error ?? 'The sensor helper refused the request.'))
    }
  }

  private request(command: Record<string, unknown>): Promise<HelperMessage> {
    if (this.closed) return Promise.reject(new Error('The sensor helper is not running.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The sensor helper did not answer.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          resolve(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.socket.write(`${JSON.stringify({ id, ...command })}\n`)
    })
  }

  async read(): Promise<HardwareReading[]> {
    return (await this.request({ cmd: 'read' })).hardware ?? []
  }

  async set(controlId: string, duty: number): Promise<void> {
    await this.request({ cmd: 'set', control: controlId, value: duty })
  }

  async restore(controlId: string): Promise<void> {
    await this.request({ cmd: 'default', control: controlId })
  }

  async readChipCurve(controlId: string): Promise<ChipPoint[]> {
    return (await this.request({ cmd: 'chipCurveRead', control: controlId })).curve?.points ?? []
  }

  async writeChipCurve(controlId: string, points: ChipPoint[]): Promise<ChipPoint[]> {
    return (await this.request({ cmd: 'chipCurveWrite', control: controlId, points })).curve?.points ?? []
  }

  onExit(listener: (reason: string) => void): void {
    this.exitListeners.push(listener)
  }

  private shutdown(reason: string): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason))
    this.pending.clear()
    this.socket.destroy()
    this.server.close()
    for (const listener of this.exitListeners) listener(reason)
  }

  /** Closing the pipe makes the helper give every fan back to the BIOS and exit. */
  close(): void {
    this.shutdown('Stopped.')
  }
}

// ---- Service ----------------------------------------------------------------

export function isVendorFanServiceRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('sc.exe', ['query', VENDOR_FAN_SERVICE], { windowsHide: true }, (error, stdout) => {
      resolve(!error && /STATE\s*:\s*\d+\s+RUNNING/i.test(stdout))
    })
  })
}

export interface SensorServiceOptions {
  logger: Logger
  helperPaths: HelperPaths
  simulate: boolean
  /** Current fan settings, read every tick so edits apply within a second. */
  fanConfigs: () => Record<string, FanChannelConfig>
  /** Each chip-curve header's curve from before Streamline first wrote it. */
  chipOriginals: () => Record<string, ChipPoint[]>
  saveChipOriginal: (controlId: string, points: ChipPoint[]) => void
}

/** How often chip curves are read back, to catch Armoury Crate rewriting them. */
const CHIP_VERIFY_TICKS = 30

export class SensorService {
  private backend: SensorBackend | null = null
  private timer: NodeJS.Timeout | null = null
  private ticking = false
  private state: MonitorStatus['state'] = 'off'
  private message: string | null = null
  private vendorFanService = false
  private latest: SensorSnapshot | null = null
  /** Duty Streamline last set per control; absent while the BIOS is in charge. */
  readonly targets = new Map<string, number>()
  private readonly stallStates = new Map<string, StallState>()
  /** Stalled controls, with the settings they stalled on; new settings retry. */
  private readonly stalledConfigs = new Map<string, string>()
  /** Chip curves Streamline has written and expects to find on the chip. */
  private readonly chipApplied = new Map<string, ChipPoint[]>()
  private tickCount = 0
  private readonly options: SensorServiceOptions

  constructor(options: SensorServiceOptions) {
    this.options = options
  }

  get stalled(): ReadonlySet<string> {
    return new Set(this.stalledConfigs.keys())
  }

  get snapshot(): SensorSnapshot | null {
    return this.latest
  }

  get status(): MonitorStatus {
    return {
      state: this.state,
      message: this.message,
      driverInstalled: this.backend?.driverInstalled ?? null,
      simulated: this.options.simulate,
      vendorFanServiceRunning: this.vendorFanService
    }
  }

  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return
    const { logger } = this.options
    this.state = 'starting'
    this.message = null
    try {
      if (!this.options.simulate && process.platform !== 'win32') {
        throw new Error('Sensors and fan control are only available on Windows.')
      }
      const backend = this.options.simulate
        ? new SimulatedBackend()
        : await HelperBackend.launch(this.options.helperPaths, logger)
      backend.onExit((reason) => {
        if (this.backend !== backend) return
        logger.warn('sensors', `Sensor helper exited: ${reason}`)
        this.halt('error', reason)
      })
      this.backend = backend
      this.vendorFanService = await isVendorFanServiceRunning()
      await this.tick()
      if (!this.latest?.hardware.some((hardware) => hardware.type === 'SuperIO')) {
        this.message = backend.driverInstalled
          ? 'The motherboard sensor chip was not found, so motherboard fans and temperatures are missing.'
          : 'The PawnIO driver is not installed, so motherboard fans and temperatures are missing.'
      }
      this.state = 'running'
      await this.applyChipCurves()
      this.timer = setInterval(() => void this.tick(), TICK_MS)
      logger.info('sensors', `Monitoring started (${this.latest?.hardware.length ?? 0} devices)`)
    } catch (error) {
      this.halt('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  stop(): void {
    this.halt('off', null)
  }

  private halt(state: MonitorStatus['state'], message: string | null): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const backend = this.backend
    this.backend = null
    backend?.close()
    this.targets.clear()
    this.stallStates.clear()
    this.stalledConfigs.clear()
    // Chip curves keep running on the chip; they're re-checked on the next start.
    this.chipApplied.clear()
    this.latest = null
    this.state = state
    this.message = message
  }

  /**
   * Apply a saved fan setting right away. Duty-driven fans pick it up on the
   * next tick anyway; chip-curve headers (NCT6701D) are written here: the
   * original curve is saved before the first write so BIOS mode can put it back.
   */
  async applyFanConfig(controlId: string, config: FanChannelConfig): Promise<void> {
    if (!usesChipCurve(controlId)) return
    const backend = this.backend
    if (!backend || this.state !== 'running') throw new Error('Turn on monitoring first.')
    this.stalledConfigs.delete(controlId)
    const original = this.options.chipOriginals()[controlId]
    if (config.mode === 'bios') {
      if (original && this.chipApplied.has(controlId)) {
        await backend.writeChipCurve(controlId, original)
        this.options.logger.info('fans', `${controlId}: original chip curve restored`)
      }
      this.chipApplied.delete(controlId)
      return
    }
    if (!original) this.options.saveChipOriginal(controlId, await backend.readChipCurve(controlId))
    const points = chipCurvePoints(config)
    const written = await backend.writeChipCurve(controlId, points)
    if (!sameChipCurve(points, written)) throw new Error('The fan chip did not keep the curve that was written.')
    this.chipApplied.set(controlId, points)
    this.options.logger.info('fans', `${controlId}: chip curve ${points.map((point) => `${point.temp}:${point.duty}`).join(' ')}`)
  }

  /** Re-write every saved chip curve, e.g. at start-up or after Armoury Crate restored its own on resume. */
  async applyChipCurves(): Promise<void> {
    const configs = this.options.fanConfigs()
    for (const [controlId, config] of Object.entries(configs)) {
      if (!usesChipCurve(controlId) || config.mode === 'bios') continue
      try {
        await this.applyFanConfig(controlId, config)
      } catch (error) {
        this.options.logger.warn('fans', `${controlId}: could not apply chip curve: ${String(error)}`)
      }
    }
  }

  /** Read every sensor, then move each software-controlled fan toward its curve. */
  private async tick(): Promise<void> {
    const backend = this.backend
    if (!backend || this.ticking) return
    this.ticking = true
    this.tickCount += 1
    try {
      const snapshot = { at: Date.now(), hardware: await backend.read() }
      this.latest = snapshot
      const configs = this.options.fanConfigs()
      const controls = snapshot.hardware.flatMap((hardware) => hardware.sensors.filter((sensor) => sensor.type === 'Control'))
      for (const control of controls) {
        if (usesChipCurve(control.id)) {
          await this.checkChipCurve(backend, snapshot, control.id)
          continue
        }
        const config = configs[control.id]
        const configKey = JSON.stringify(config ?? null)
        if (this.stalledConfigs.has(control.id) && this.stalledConfigs.get(control.id) !== configKey) {
          this.stalledConfigs.delete(control.id)
        }
        const stalled = this.stalledConfigs.has(control.id)
        const previous = this.targets.get(control.id) ?? null
        const next =
          config && !stalled && canSetDuty(control.id)
            ? targetDuty(config, findSensor(snapshot, config.sourceId)?.value ?? null, previous)
            : null

        const rpm = findSensor(snapshot, fanIdForControl(control.id))?.value ?? null
        const stall = checkStall(this.stallStates.get(control.id), rpm, previous)
        this.stallStates.set(control.id, stall.next)
        if (stall.stalled) {
          this.options.logger.warn('fans', `${control.id} stopped at ${previous}%; handing it back to the BIOS`)
          this.stalledConfigs.set(control.id, configKey)
          this.stallStates.set(control.id, { ...stall.next, zeroTicks: 0 })
          await backend.restore(control.id)
          this.targets.delete(control.id)
          continue
        }

        if (next === null) {
          if (previous !== null || control.software) {
            await backend.restore(control.id)
            this.targets.delete(control.id)
          }
        } else if (next !== previous || !control.software) {
          // Also re-asserts a fan something else (e.g. Armoury Crate) took back.
          await backend.set(control.id, next)
          this.targets.set(control.id, next)
        }
      }
    } catch (error) {
      if (this.backend === backend) this.options.logger.warn('sensors', `Sensor update failed: ${String(error)}`)
    } finally {
      this.ticking = false
    }
  }

  /**
   * The chip runs the curve itself, so Streamline only watches: if the fan
   * stops while the curve says it should spin, the original curve goes back;
   * every so often the curve is read back in case Armoury Crate replaced it.
   */
  private async checkChipCurve(backend: SensorBackend, snapshot: SensorSnapshot, controlId: string): Promise<void> {
    const applied = this.chipApplied.get(controlId)
    if (!applied) return
    const temp = findSensor(snapshot, preferredSource(snapshot))?.value ?? null
    const expected = temp === null ? 100 : chipCurveDuty(applied, temp)
    const rpm = findSensor(snapshot, fanIdForControl(controlId))?.value ?? null
    const stall = checkStall(this.stallStates.get(controlId), rpm, expected)
    this.stallStates.set(controlId, stall.next)
    if (stall.stalled) {
      this.options.logger.warn('fans', `${controlId} stopped on its chip curve; restoring the original curve`)
      this.stalledConfigs.set(controlId, JSON.stringify(this.options.fanConfigs()[controlId] ?? null))
      this.stallStates.set(controlId, { ...stall.next, zeroTicks: 0 })
      this.chipApplied.delete(controlId)
      const original = this.options.chipOriginals()[controlId]
      if (original) await backend.writeChipCurve(controlId, original)
      return
    }
    if (this.tickCount % CHIP_VERIFY_TICKS === 0 && !sameChipCurve(applied, await backend.readChipCurve(controlId))) {
      this.options.logger.warn('fans', `${controlId}: chip curve was changed by something else; writing it again`)
      await backend.writeChipCurve(controlId, applied)
    }
  }
}
