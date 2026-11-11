import { useCallback, useRef, useState } from 'react'
import type { HardwareReading, SensorsStatus } from '@shared/types'
import { MonitorNotices, MonitorOff } from '../components/Monitor'
import { api, errorMessage } from '../lib/api'
import { TYPE_LABELS, formatValue, groupByType, usePolling } from '../lib/sensors'
import { useApp } from '../state/AppState'

const HISTORY = 90

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
    const sensor = hw?.sensors.find((entry) => entry.type === type && pattern.test(entry.name)) ?? hw?.sensors.find((entry) => entry.type === type)
    if (sensor) result.push({ key: sensor.id, label, type, value: sensor.value })
  }
  const cpu = hardware.find((hw) => hw.type === 'Cpu')
  const gpu = hardware.find((hw) => hw.type.startsWith('Gpu'))
  pick(cpu, 'Temperature', /tctl|tdie|package/i, 'CPU temperature')
  pick(gpu, 'Temperature', /core/i, 'GPU temperature')
  pick(cpu, 'Load', /total/i, 'CPU load')
  pick(gpu, 'Load', /core/i, 'GPU load')
  pick(hardware.find((hw) => hw.type === 'Memory'), 'Load', /memory/i, 'Memory used')
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

export function OverviewPage() {
  const { notify } = useApp()
  const [status, setStatus] = useState<SensorsStatus | null>(null)
  const history = useRef(new Map<string, number[]>())
  const [filter, setFilter] = useState('')

  const refresh = useCallback(async () => {
    try {
      const next = await api.sensors.status()
      for (const hw of next.snapshot?.hardware ?? []) {
        for (const sensor of hw.sensors) {
          if (sensor.value === null) continue
          const list = history.current.get(sensor.id) ?? []
          list.push(sensor.value)
          if (list.length > HISTORY) list.shift()
          history.current.set(sensor.id, list)
        }
      }
      setStatus(next)
    } catch (error) {
      notify(errorMessage(error), 'error')
      throw error
    }
  }, [notify])

  usePolling(refresh, 1000)

  const stop = async () => {
    try {
      setStatus(await api.sensors.stop())
      notify('Monitoring stopped; fans are back under BIOS control')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const monitor = status?.monitor ?? null
  const running = monitor?.state === 'running'
  const hardware = status?.snapshot?.hardware ?? []
  const needle = filter.trim().toLowerCase()

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <p>Live temperatures, fan speeds and load from your PC.</p>
        </div>
        <div className="toolbar">
          {running && (
            <>
              <input
                className="input"
                placeholder="Filter sensors"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <button className="button button--ghost" onClick={() => void stop()}>
                Turn off monitoring
              </button>
            </>
          )}
        </div>
      </div>

      {!running ? (
        status && <MonitorOff monitor={monitor} onStarted={() => void refresh()} />
      ) : (
        <>
          <MonitorNotices monitor={monitor} />

          <div className="tiles">
            {highlights(hardware).map((tile) => (
              <div className="tile" key={tile.key}>
                <div className="tile__label">{tile.label}</div>
                <div className="tile__value">{formatValue(tile.type, tile.value)}</div>
                <Sparkline values={history.current.get(tile.key) ?? []} />
              </div>
            ))}
          </div>

          {hardware
            .filter((hw) => hw.sensors.length > 0)
            .map((hw) => {
              const sensors = needle
                ? hw.sensors.filter((sensor) => `${hw.name} ${sensor.name} ${sensor.type}`.toLowerCase().includes(needle))
                : hw.sensors
              if (sensors.length === 0) return null
              return (
                <section className="panel" key={hw.id}>
                  <h2>
                    {hw.name} <span className="badge">{hw.type}</span>
                  </h2>
                  <div className="sensor-groups">
                    {groupByType(sensors).map(([type, list]) => (
                      <div className="sensor-group" key={type}>
                        <div className="sensor-group__title">{TYPE_LABELS[type] ?? type}</div>
                        <div className="sensor-table">
                          <div className="sensor-table__head">
                            <span>Sensor</span>
                            <span>Now</span>
                            <span>Min</span>
                            <span>Max</span>
                          </div>
                          {list.map((sensor) => (
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
                </section>
              )
            })}
        </>
      )}
    </>
  )
}
