import { useState } from 'react'
import type { HardwareReading } from '@shared/types'
import { Icon } from '../components/Icon'
import { MonitorNotices, MonitorOff } from '../components/Monitor'
import { TYPE_LABELS, formatValue, groupByType } from '../lib/sensors'
import type { SensorsState } from '../state/useSensors'

interface Highlight {
  key: string
  label: string
  type: string
  value: number | null
}

/** The handful of numbers worth seeing at a glance. */
function highlights(hardware: HardwareReading[]): Highlight[] {
  const result: Highlight[] = []
  const pick = (hw: HardwareReading | undefined, type: string, pattern: RegExp, label: string) => {
    const sensor =
      hw?.sensors.find((entry) => entry.type === type && pattern.test(entry.name)) ??
      hw?.sensors.find((entry) => entry.type === type)
    if (sensor) result.push({ key: sensor.id, label, type, value: sensor.value })
  }
  const cpu = hardware.find((hw) => hw.type === 'Cpu')
  const gpu = hardware.find((hw) => hw.type.startsWith('Gpu'))
  pick(cpu, 'Temperature', /tctl|tdie|package/i, 'CPU temperature')
  pick(gpu, 'Temperature', /core/i, 'GPU temperature')
  pick(cpu, 'Load', /total/i, 'CPU load')
  pick(gpu, 'Load', /core/i, 'GPU load')
  pick(
    hardware.find((hw) => hw.type === 'Memory'),
    'Load',
    /memory/i,
    'Memory used'
  )
  for (const hw of hardware.filter((entry) => entry.type === 'SuperIO')) {
    for (const fan of hw.sensors.filter((sensor) => sensor.type === 'Fan')) {
      result.push({ key: fan.id, label: fan.name, type: 'Fan', value: fan.value })
    }
  }
  return result
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 28" />
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 100},${26 - ((value - low) / span) * 24}`)
    .join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
      <polyline points={points} />
    </svg>
  )
}

/** The strip of live vitals at the top of the workspace, or the switch to turn monitoring on. */
export function Vitals({ sensors }: { sensors: SensorsState }) {
  const { status, history, refresh, stop } = sensors
  const monitor = status?.monitor ?? null

  if (monitor?.state !== 'running') {
    return status ? <MonitorOff monitor={monitor} onStarted={() => void refresh()} /> : null
  }

  return (
    <>
      <MonitorNotices monitor={monitor} />
      <div className="section-label" id="overview">
        <span className="live-dot" aria-hidden />
        Live{monitor.simulated ? ' (simulated)' : ''}
        <span className="toolbar__spacer" />
        <button className="button button--quiet button--small" onClick={() => void stop()}>
          <Icon name="power" size={13} />
          Turn off monitoring
        </button>
      </div>
      <div className="vitals">
        {highlights(status?.snapshot?.hardware ?? []).map((tile) => (
          <div className="vital" key={tile.key}>
            <div className="vital__label">{tile.label}</div>
            <div className="vital__value">{formatValue(tile.type, tile.value)}</div>
            <Sparkline values={history.get(tile.key) ?? []} />
          </div>
        ))}
      </div>
    </>
  )
}

/** Every sensor the chip reports, grouped by device and kind, folded away until wanted. */
export function SensorsSection({ sensors }: { sensors: SensorsState }) {
  const { status } = sensors
  const [filter, setFilter] = useState('')
  const running = status?.monitor?.state === 'running'
  if (!running) return null

  const hardware = status?.snapshot?.hardware ?? []
  const needle = filter.trim().toLowerCase()
  const count = hardware.reduce((sum, hw) => sum + hw.sensors.length, 0)

  return (
    <details className="card card--fold" id="sensors">
      <summary className="card__head">
        <span className="card__title">
          <Icon name="sensors" />
          All sensors
          <span className="card__meta">{count} readings</span>
        </span>
        <span className="card__chevron" aria-hidden />
      </summary>

      <div className="card__body">
        <div className="toolbar" style={{ marginBottom: 18 }}>
          <label className="search">
            <Icon name="search" size={14} />
            <input
              placeholder="Filter sensors"
              aria-label="Filter sensors"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>

        {hardware
          .filter((hw) => hw.sensors.length > 0)
          .map((hw) => {
            const list = needle
              ? hw.sensors.filter((sensor) => `${hw.name} ${sensor.name} ${sensor.type}`.toLowerCase().includes(needle))
              : hw.sensors
            if (list.length === 0) return null
            return (
              <div className="device" key={hw.id}>
                <div className="device__name">
                  {hw.name} <span className="badge">{hw.type}</span>
                </div>
                <div className="sensor-groups">
                  {groupByType(list).map(([type, group]) => (
                    <div className="sensor-group" key={type}>
                      <div className="sensor-group__title">{TYPE_LABELS[type] ?? type}</div>
                      <div className="sensor-table">
                        <div className="sensor-table__head">
                          <span>Sensor</span>
                          <span>Now</span>
                          <span>Min</span>
                          <span>Max</span>
                        </div>
                        {group.map((sensor) => (
                          <div className="sensor-table__row" key={sensor.id} title={sensor.id}>
                            <span>{sensor.name}</span>
                            <span className="sensor-table__now">{formatValue(sensor.type, sensor.value)}</span>
                            <span>{formatValue(sensor.type, sensor.min)}</span>
                            <span>{formatValue(sensor.type, sensor.max)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
      </div>
    </details>
  )
}
