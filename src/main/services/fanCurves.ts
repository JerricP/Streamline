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

/** At or above this source temperature every curve runs its fan flat out. */
export const PANIC_TEMP = 95
/** Largest duty change per second, so fans ramp instead of jumping on short spikes. */
export const RAMP_UP_PER_TICK = 8
export const RAMP_DOWN_PER_TICK = 3

export const DEFAULT_POINTS: FanCurvePoint[] = [
  { temp: 30, duty: 30 },
  { temp: 50, duty: 40 },
  { temp: 65, duty: 60 },
  { temp: 80, duty: 100 }
]

export function defaultConfig(sourceId: string | null): FanChannelConfig {
  return { mode: 'bios', fixedDuty: 50, sourceId, points: DEFAULT_POINTS.map((point) => ({ ...point })) }
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
  const sourceId = typeof input.sourceId === 'string' && input.sourceId.length > 0 ? input.sourceId : null
  if (input.mode === 'curve' && !sourceId) throw new Error('Pick a temperature for the curve to follow')
  return { mode: input.mode as FanChannelConfig['mode'], fixedDuty: Math.round(clamp(fixedDuty, 0, 100)), sourceId, points }
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
  if (config.mode === 'fixed') return config.fixedDuty
  if (sourceTemp === null || !Number.isFinite(sourceTemp) || sourceTemp >= PANIC_TEMP) return 100
  const wanted = Math.round(evaluateCurve(config.points, sourceTemp))
  if (previous === null) return wanted
  if (wanted > previous) return Math.min(wanted, previous + RAMP_UP_PER_TICK)
  return Math.max(wanted, previous - RAMP_DOWN_PER_TICK)
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
  targets: Map<string, number>
): FanChannel[] {
  if (!snapshot) return []
  const fallbackSource = preferredSource(snapshot)
  return snapshot.hardware.flatMap((hardware) =>
    hardware.sensors
      .filter((sensor) => sensor.type === 'Control')
      .map((control) => {
        const fan = hardware.sensors.find((sensor) => sensor.id === fanIdForControl(control.id)) ?? null
        const config = configs[control.id] ?? defaultConfig(fallbackSource)
        const source = findSensor(snapshot, config.sourceId)
        return {
          controlId: control.id,
          fanId: fan?.id ?? null,
          name: fan?.name ?? control.name,
          rpm: fan?.value ?? null,
          duty: control.value,
          target: targets.get(control.id) ?? null,
          sourceTemp: source?.value ?? null,
          config
        }
      })
  )
}
