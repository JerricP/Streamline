import { useEffect, useRef } from 'react'
import type { SensorReading } from '@shared/types'

/** Calls `task` now and then every `ms` while the page is visible. */
export function usePolling(task: () => Promise<void> | void, ms: number): void {
  const latest = useRef(task)
  latest.current = task
  useEffect(() => {
    let stopped = false
    let timer: number | undefined
    const run = async () => {
      if (!document.hidden) {
        try {
          await latest.current()
        } catch {
          // The task reports its own errors; keep polling.
        }
      }
      if (!stopped) timer = window.setTimeout(run, ms)
    }
    void run()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [ms])
}

const UNITS: Record<string, { unit: string; digits: number }> = {
  Temperature: { unit: '°C', digits: 1 },
  Fan: { unit: 'RPM', digits: 0 },
  Control: { unit: '%', digits: 0 },
  Load: { unit: '%', digits: 1 },
  Level: { unit: '%', digits: 1 },
  Clock: { unit: 'MHz', digits: 0 },
  Frequency: { unit: 'Hz', digits: 0 },
  Power: { unit: 'W', digits: 1 },
  Voltage: { unit: 'V', digits: 3 },
  Current: { unit: 'A', digits: 2 },
  Data: { unit: 'GB', digits: 1 },
  SmallData: { unit: 'MB', digits: 0 },
  Flow: { unit: 'L/h', digits: 0 },
  Noise: { unit: 'dBA', digits: 0 },
  Humidity: { unit: '%', digits: 0 },
  Throughput: { unit: 'B/s', digits: 0 }
}

export function formatValue(type: string, value: number | null): string {
  if (value === null) return '—'
  if (type === 'Throughput') {
    const steps = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    let scaled = value
    let step = 0
    while (scaled >= 1024 && step < steps.length - 1) {
      scaled /= 1024
      step += 1
    }
    return `${scaled.toFixed(step === 0 ? 0 : 1)} ${steps[step]}`
  }
  const format = UNITS[type] ?? { unit: '', digits: 2 }
  return `${value.toFixed(format.digits)}${format.unit ? (format.unit === '°C' || format.unit === '%' ? '' : ' ') + format.unit : ''}`
}

/** Display order of sensor groups on the overview. */
export const TYPE_ORDER = [
  'Temperature',
  'Fan',
  'Control',
  'Load',
  'Clock',
  'Power',
  'Voltage',
  'Current',
  'Data',
  'SmallData',
  'Throughput'
]

export const TYPE_LABELS: Record<string, string> = {
  Temperature: 'Temperatures',
  Fan: 'Fans',
  Control: 'Fan duty',
  Load: 'Load',
  Clock: 'Clocks',
  Power: 'Power',
  Voltage: 'Voltages',
  Current: 'Current',
  Data: 'Data',
  SmallData: 'Data',
  Throughput: 'Throughput',
  Level: 'Level',
  Factor: 'Factor',
  Frequency: 'Frequency',
  Flow: 'Flow',
  TimeSpan: 'Time',
  Energy: 'Energy',
  Noise: 'Noise',
  Humidity: 'Humidity',
  Timing: 'Timing',
  Conductivity: 'Conductivity'
}

export function groupByType(sensors: SensorReading[]): Array<[string, SensorReading[]]> {
  const groups = new Map<string, SensorReading[]>()
  for (const sensor of sensors) {
    const list = groups.get(sensor.type) ?? []
    list.push(sensor)
    groups.set(sensor.type, list)
  }
  const rank = (type: string) => {
    const index = TYPE_ORDER.indexOf(type)
    return index < 0 ? TYPE_ORDER.length : index
  }
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

export const PAWNIO_URL = 'https://pawnio.eu/'
