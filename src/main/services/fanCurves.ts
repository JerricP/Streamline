import type {
  FanChannel,
  FanChannelConfig,
  FanCurvePoint,
  SensorReading,
  SensorSnapshot,
  TemperatureSource
} from '@shared/types'

/**
 * Fan curve maths and the per-second control decision. Pure functions only,
 * so every safety rule here is covered by unit tests.
 */

export const MIN_POINTS = 2
export const MAX_POINTS = 8
export const MIN_TEMP = 0
export const MAX_TEMP = 110
export const MAX_NAME_LENGTH = 40

/** At or above this source temperature every curve runs its fan flat out. */
export const PANIC_TEMP = 95
/** Largest duty change per second, so fans ramp instead of jumping on short spikes. */
export const RAMP_UP_PER_TICK = 8
export const RAMP_DOWN_PER_TICK = 3

/**
 * Hardware whose fans Streamline offers to control: motherboard headers and
 * coolers. Graphics card fans are left to the driver, which also handles
 * their zero-RPM idle mode.
 */
export const CONTROLLABLE_HARDWARE = ['SuperIO', 'EmbeddedController', 'Cooler']

/**
 * Controls whose duty LibreHardwareMonitorLib 0.9.6 can't set correctly. On
 * the ROG Strix B850-I (NCT6701D) any duty it set, even 100%, stopped the AIO
 * radiator fans (tested 2026-10-25): it switches the header to manual PWM but
 * leaves the chip's DC curve, which is all zeros, powering the fan.
 */
const NO_DUTY_CONTROLS = [/^\/lpc\/nct6701d\//]

/** Streamline can drive this fan by setting its duty every second. */
export function canSetDuty(controlId: string): boolean {
  return !NO_DUTY_CONTROLS.some((pattern) => pattern.test(controlId))
}

/**
 * NCT6701D headers that are driven the way Armoury Crate does it: by writing
 * the chip's own 10-point curve, which it then runs by itself. Only headers
 * whose register bank was verified on the B850-I are listed (the helper keeps
 * the same list); the rest stay read-only. CPU_FAN (control/1, bank 2) is
 * left out until chip curves are proven on the chassis header, because on
 * this PC it drives the AIO pump.
 */
const CHIP_CURVE_CONTROLS = ['/lpc/nct6701d/0/control/0']

export function usesChipCurve(controlId: string): boolean {
  return CHIP_CURVE_CONTROLS.includes(controlId)
}

export function canControl(controlId: string): boolean {
  return canSetDuty(controlId) || usesChipCurve(controlId)
}

/** A point as the chip stores it: °C and duty 0-255. */
export interface ChipPoint {
  temp: number
  duty: number
}

export const CHIP_POINTS = 10
/** The chip's curve temperatures are whole °C; keep them in a sane range. */
const CHIP_MAX_TEMP = 100

const toChipDuty = (percent: number) => Math.round((clamp(percent, 0, 100) * 255) / 100)

/**
 * Turns a fan setting into the chip's 10 points. The chip follows its own CPU
 * temperature input, so a curve's chosen source doesn't apply. Below the first
 * point the fan holds the first duty, a point at PANIC_TEMP forces 100% (as
 * the software curves do), and unused slots repeat the last point, as ASUS does.
 */
export function chipCurvePoints(config: FanChannelConfig): ChipPoint[] {
  const floor = config.minDuty ?? 0
  const user =
    config.mode === 'fixed'
      ? [{ temp: 0, duty: config.fixedDuty }]
      : [...config.points].sort((a, b) => a.temp - b.temp)
  let points = user.map((point) => ({ temp: Math.round(clamp(point.temp, 0, CHIP_MAX_TEMP)), duty: Math.max(floor, point.duty) }))
  if (points[0].temp > 0) points.unshift({ temp: 0, duty: points[0].duty })
  if (points[points.length - 1].temp < PANIC_TEMP) points.push({ temp: PANIC_TEMP, duty: 100 })
  // Keep the panic point even if the user used every slot.
  if (points.length > CHIP_POINTS) points = [...points.slice(0, CHIP_POINTS - 1), points[points.length - 1]]
  while (points.length < CHIP_POINTS) points.push({ ...points[points.length - 1] })
  return points.map((point) => ({ temp: point.temp, duty: toChipDuty(point.duty) }))
}

/** Duty the chip should be running at this temperature, in percent. */
export function chipCurveDuty(points: ChipPoint[], temp: number): number {
  return (evaluateCurve(points, temp) * 100) / 255
}

export function sameChipCurve(a: ChipPoint[], b: ChipPoint[]): boolean {
  return a.length === b.length && a.every((point, index) => point.temp === b[index].temp && point.duty === b[index].duty)
}

export const DEFAULT_POINTS: FanCurvePoint[] = [
  { temp: 30, duty: 30 },
  { temp: 50, duty: 40 },
  { temp: 65, duty: 60 },
  { temp: 80, duty: 100 }
]

export function defaultConfig(sourceId: string | null): FanChannelConfig {
  return { name: null, mode: 'bios', minDuty: 0, fixedDuty: 50, sourceId, points: DEFAULT_POINTS.map((point) => ({ ...point })) }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The web UI is untrusted input: rebuild a config from known fields only. */
export function sanitizeFanConfig(input: Partial<FanChannelConfig>): FanChannelConfig {
  if (!input || !['bios', 'fixed', 'curve'].includes(input.mode as string)) throw new Error('Unknown fan mode')
  const fixedDuty = Number(input.fixedDuty)
  if (!Number.isFinite(fixedDuty)) throw new Error('Fixed speed must be a number')
  if (!Array.isArray(input.points)) throw new Error('A fan curve needs points')
  if (input.points.length < MIN_POINTS || input.points.length > MAX_POINTS) {
    throw new Error(`A fan curve needs ${MIN_POINTS} to ${MAX_POINTS} points`)
  }
  const points = input.points
    .map((point) => ({ temp: Number(point?.temp), duty: Number(point?.duty) }))
    .map((point) => {
      if (!Number.isFinite(point.temp) || !Number.isFinite(point.duty)) throw new Error('Curve points must be numbers')
      return { temp: Math.round(clamp(point.temp, MIN_TEMP, MAX_TEMP)), duty: Math.round(clamp(point.duty, 0, 100)) }
    })
    .sort((a, b) => a.temp - b.temp)
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].temp === points[index - 1].temp) throw new Error('Two curve points share a temperature')
  }
  const minDuty = Number(input.minDuty ?? 0)
  if (!Number.isFinite(minDuty)) throw new Error('Minimum speed must be a number')
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, MAX_NAME_LENGTH) : null
  const sourceId = typeof input.sourceId === 'string' && input.sourceId.length > 0 ? input.sourceId : null
  if (input.mode === 'curve' && !sourceId) throw new Error('Pick a temperature for the curve to follow')
  return {
    name,
    mode: input.mode as FanChannelConfig['mode'],
    minDuty: Math.round(clamp(minDuty, 0, 100)),
    fixedDuty: Math.round(clamp(fixedDuty, 0, 100)),
    sourceId,
    points
  }
}

/** Duty for a temperature: flat before the first point and after the last, linear between. */
export function evaluateCurve(points: FanCurvePoint[], temp: number): number {
  if (points.length === 0) return 100
  if (temp <= points[0].temp) return points[0].duty
  const last = points[points.length - 1]
  if (temp >= last.temp) return last.duty
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]
    if (temp <= right.temp) {
      const left = points[index - 1]
      const share = (temp - left.temp) / (right.temp - left.temp)
      return left.duty + share * (right.duty - left.duty)
    }
  }
  return last.duty
}

/**
 * What a fan should be set to this second, or null to leave it to the BIOS.
 * A curve whose temperature can't be read runs at 100%: failing loud and cool
 * beats failing quiet and hot.
 */
export function targetDuty(config: FanChannelConfig, sourceTemp: number | null, previous: number | null): number | null {
  if (config.mode === 'bios') return null
  const floor = config.minDuty ?? 0
  if (config.mode === 'fixed') return Math.max(floor, config.fixedDuty)
  // 0 °C or below is a sensor that isn't really being read (e.g. without driver access), not a cold PC.
  if (sourceTemp === null || !Number.isFinite(sourceTemp) || sourceTemp <= 0 || sourceTemp >= PANIC_TEMP) return 100
  const wanted = Math.max(floor, Math.round(evaluateCurve(config.points, sourceTemp)))
  if (previous === null) return wanted
  if (wanted > previous) return Math.min(wanted, previous + RAMP_UP_PER_TICK)
  return Math.max(wanted, previous - RAMP_DOWN_PER_TICK)
}

// ---- Stall guard ------------------------------------------------------------

/** Seconds a fan may read 0 RPM under Streamline before it goes back to the BIOS. */
export const STALL_TICKS = 6
/** Below this a stopped fan may be intended (fan-stop curves), so it isn't a stall. */
export const STALL_MIN_DUTY = 25

export interface StallState {
  /** The fan has reported RPM at some point, so a fan is really plugged in. */
  seenSpinning: boolean
  zeroTicks: number
}

/**
 * Catches a fan that spins under the BIOS but stops once Streamline drives it
 * (a header in an unexpected mode, or a chip the library drives wrongly).
 * Fans without a tachometer can't be checked and are never flagged.
 */
export function checkStall(
  state: StallState | undefined,
  rpm: number | null,
  target: number | null
): { next: StallState; stalled: boolean } {
  const previous = state ?? { seenSpinning: false, zeroTicks: 0 }
  if (rpm === null) return { next: previous, stalled: false }
  const seenSpinning = previous.seenSpinning || rpm > 0
  if (target === null || target < STALL_MIN_DUTY || rpm > 0 || !seenSpinning) {
    return { next: { seenSpinning, zeroTicks: 0 }, stalled: false }
  }
  const zeroTicks = previous.zeroTicks + 1
  return { next: { seenSpinning, zeroTicks }, stalled: zeroTicks >= STALL_TICKS }
}

// ---- Reading the snapshot -------------------------------------------------

export function findSensor(snapshot: SensorSnapshot | null, id: string | null): SensorReading | null {
  if (!snapshot || !id) return null
  for (const hardware of snapshot.hardware) {
    const sensor = hardware.sensors.find((entry) => entry.id === id)
    if (sensor) return sensor
  }
  return null
}

/** LibreHardwareMonitor numbers a chip's fan inputs and PWM outputs the same way. */
export function fanIdForControl(controlId: string): string {
  return controlId.replace(/\/control\/(\d+)$/, '/fan/$1')
}

export function temperatureSources(snapshot: SensorSnapshot | null): TemperatureSource[] {
  if (!snapshot) return []
  return snapshot.hardware.flatMap((hardware) =>
    hardware.sensors
      .filter((sensor) => sensor.type === 'Temperature')
      .map((sensor) => ({ id: sensor.id, name: sensor.name, hardware: hardware.name, value: sensor.value }))
  )
}

/**
 * Best default for a new curve: the CPU package temperature (AMD "Tctl/Tdie",
 * Intel "Package"), else the first CPU temperature, else anything.
 */
export function preferredSource(snapshot: SensorSnapshot | null): string | null {
  const sources = temperatureSources(snapshot)
  const cpu = snapshot?.hardware.filter((hardware) => hardware.type === 'Cpu').map((hardware) => hardware.name) ?? []
  const cpuSources = sources.filter((source) => cpu.includes(source.hardware))
  return (
    cpuSources.find((source) => /tctl|tdie|package/i.test(source.name))?.id ??
    cpuSources[0]?.id ??
    sources[0]?.id ??
    null
  )
}

export function fanChannels(
  snapshot: SensorSnapshot | null,
  configs: Record<string, FanChannelConfig>,
  targets: Map<string, number>,
  stalled: ReadonlySet<string> = new Set()
): FanChannel[] {
  if (!snapshot) return []
  const fallbackSource = preferredSource(snapshot)
  return snapshot.hardware
    .filter((hardware) => CONTROLLABLE_HARDWARE.includes(hardware.type))
    .flatMap((hardware) =>
      hardware.sensors
        .filter((sensor) => sensor.type === 'Control')
        .map((control) => {
          const fan = hardware.sensors.find((sensor) => sensor.id === fanIdForControl(control.id)) ?? null
          // Merge so settings saved before a field existed still get its default.
          const config = { ...defaultConfig(fallbackSource), ...configs[control.id] }
          // Chip curves follow the chip's own CPU input; show the CPU temperature for them.
          const source = findSensor(snapshot, usesChipCurve(control.id) ? fallbackSource : config.sourceId)
          return {
            controlId: control.id,
            fanId: fan?.id ?? null,
            name: config.name ?? fan?.name ?? control.name,
            chipName: fan?.name ?? control.name,
            rpm: fan?.value ?? null,
            duty: control.value,
            target: targets.get(control.id) ?? null,
            sourceTemp: source?.value ?? null,
            stalled: stalled.has(control.id),
            controllable: canControl(control.id),
            chipCurve: usesChipCurve(control.id),
            config
          }
        })
    )
}
