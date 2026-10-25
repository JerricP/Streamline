import { useCallback, useEffect, useState } from 'react'
import type { FanChannel, FanChannelConfig, FanCurvePoint, FanMode, FansStatus } from '@shared/types'
import { FanCurveEditor } from '../components/FanCurveEditor'
import { MonitorNotices, MonitorOff } from '../components/Monitor'
import { api, errorMessage } from '../lib/api'
import { usePolling } from '../lib/sensors'
import { useApp } from '../state/AppState'

const MODES: Array<{ mode: FanMode; label: string; hint: string }> = [
  { mode: 'bios', label: 'BIOS', hint: "The board's own Q-Fan settings decide. Same as when Streamline isn't running." },
  { mode: 'curve', label: 'Curve', hint: 'Follow a temperature along the curve below.' },
  { mode: 'fixed', label: 'Fixed', hint: 'Run at one speed all the time.' }
]

const PRESETS: Array<{ label: string; points: FanCurvePoint[] }> = [
  {
    label: 'Silent',
    points: [
      { temp: 35, duty: 20 },
      { temp: 55, duty: 30 },
      { temp: 70, duty: 50 },
      { temp: 85, duty: 100 }
    ]
  },
  {
    label: 'Balanced',
    points: [
      { temp: 30, duty: 30 },
      { temp: 50, duty: 40 },
      { temp: 65, duty: 60 },
      { temp: 80, duty: 100 }
    ]
  },
  {
    label: 'Performance',
    points: [
      { temp: 30, duty: 45 },
      { temp: 50, duty: 60 },
      { temp: 65, duty: 80 },
      { temp: 75, duty: 100 }
    ]
  },
  {
    label: 'Full speed',
    points: [
      { temp: 20, duty: 100 },
      { temp: 100, duty: 100 }
    ]
  }
]

/** Below this, many CPU coolers stall or trip the BIOS "CPU fan error". */
const CPU_FAN_FLOOR = 20

const sameConfig = (a: FanChannelConfig, b: FanChannelConfig) => JSON.stringify(a) === JSON.stringify(b)

export function FansPage() {
  const { notify } = useApp()
  const [status, setStatus] = useState<FansStatus | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<FanChannelConfig | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.fans.status())
    } catch (error) {
      notify(errorMessage(error), 'error')
      throw error
    }
  }, [notify])

  usePolling(refresh, 1000)

  const channels = status?.channels ?? []
  const channel: FanChannel | undefined = channels.find((entry) => entry.controlId === selected) ?? channels[0]

  // Start editing from the saved settings whenever another fan is picked.
  useEffect(() => {
    setDraft(channel ? structuredClone(channel.config) : null)
  }, [channel?.controlId])

  const save = async () => {
    if (!channel || !draft) return
    setSaving(true)
    try {
      const next = await api.fans.save(channel.controlId, draft)
      setStatus(next)
      notify(`${channel.name} saved`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const monitor = status?.monitor ?? null
  if (monitor?.state !== 'running') {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Fans</h1>
            <p>Fan curves for the motherboard's fan headers.</p>
          </div>
        </div>
        {status && <MonitorOff monitor={monitor} onStarted={() => void refresh()} />}
      </>
    )
  }

  const dirty = channel && draft ? !sameConfig(channel.config, draft) : false
  const lowestDuty = draft ? (draft.mode === 'fixed' ? draft.fixedDuty : Math.min(...draft.points.map((point) => point.duty))) : 100
  const cpuFanTooLow = channel && draft && draft.mode !== 'bios' && /cpu/i.test(channel.name) && lowestDuty < CPU_FAN_FLOOR
  const source = status?.temperatures.find((entry) => entry.id === draft?.sourceId)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Fans</h1>
          <p>Fan curves for the motherboard's fan headers. Changes apply within a second of saving.</p>
        </div>
      </div>

      <MonitorNotices monitor={monitor} />

      {channels.length === 0 ? (
        <div className="empty">
          <h2>No controllable fans found</h2>
          <p>The motherboard's sensor chip didn't report any fan headers. Check the notice above.</p>
        </div>
      ) : (
        <div className="fans">
          <div className="fans__list">
            {channels.map((entry) => (
              <button
                key={entry.controlId}
                className={`fan-card${entry.controlId === channel?.controlId ? ' fan-card--active' : ''}`}
                onClick={() => setSelected(entry.controlId)}
              >
                <div className="fan-card__top">
                  <span className="fan-card__name">{entry.name}</span>
                  <span className={`badge${entry.config.mode !== 'bios' ? ' badge--accent' : ''}`}>
                    {MODES.find((mode) => mode.mode === entry.config.mode)?.label}
                  </span>
                </div>
                <div className="fan-card__stats">
                  <span>{entry.rpm === null ? 'no RPM' : `${Math.round(entry.rpm)} RPM`}</span>
                  <span>{entry.duty === null ? '—' : `${Math.round(entry.duty)}%`}</span>
                </div>
                <div className="fan-card__bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, entry.duty ?? 0))}%` }} />
                </div>
              </button>
            ))}
          </div>

          {channel && draft && (
            <section className="panel fans__editor">
              <div className="fans__editor-head">
                <h2>{channel.name}</h2>
                <div className="fans__live">
                  {channel.sourceTemp !== null && draft.mode === 'curve' && <span>{channel.sourceTemp.toFixed(1)}°C</span>}
                  <span>{channel.duty === null ? '—' : `${Math.round(channel.duty)}%`}</span>
                  <span>{channel.rpm === null ? 'no RPM' : `${Math.round(channel.rpm)} RPM`}</span>
                </div>
              </div>

              <div className="chip-row">
                {MODES.map((entry) => (
                  <button
                    key={entry.mode}
                    className={`chip${draft.mode === entry.mode ? ' chip--active' : ''}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        mode: entry.mode,
                        sourceId: draft.sourceId ?? status?.temperatures[0]?.id ?? null
                      })
                    }
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <p className="panel__text">{MODES.find((entry) => entry.mode === draft.mode)?.hint}</p>

              {draft.mode === 'fixed' && (
                <div className="field">
                  <label htmlFor="fixed-duty">Speed: {draft.fixedDuty}%</label>
                  <input
                    id="fixed-duty"
                    type="range"
                    min={0}
                    max={100}
                    value={draft.fixedDuty}
                    className="slider"
                    onChange={(event) => setDraft({ ...draft, fixedDuty: Number(event.target.value) })}
                  />
                </div>
              )}

              {draft.mode === 'curve' && (
                <>
                  <div className="toolbar" style={{ marginBottom: 12 }}>
                    <label className="field__inline" htmlFor="curve-source">
                      Follows
                    </label>
                    <select
                      id="curve-source"
                      className="select"
                      value={draft.sourceId ?? ''}
                      onChange={(event) => setDraft({ ...draft, sourceId: event.target.value || null })}
                    >
                      {status?.temperatures.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.hardware} · {entry.name}
                          {entry.value === null ? '' : ` (${entry.value.toFixed(0)}°C)`}
                        </option>
                      ))}
                    </select>
                    <span className="toolbar__spacer" />
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        className="chip"
                        onClick={() => setDraft({ ...draft, points: preset.points.map((point) => ({ ...point })) })}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <FanCurveEditor
                    points={draft.points}
                    onChange={(points) => setDraft({ ...draft, points })}
                    currentTemp={source?.value ?? null}
                    currentDuty={dirty ? null : channel.target}
                  />
                </>
              )}

              {cpuFanTooLow && (
                <p className="panel__text panel__text--error">
                  CPU fans below {CPU_FAN_FLOOR}% can stall, and the BIOS may report a CPU fan error at boot.
                </p>
              )}

              <div className="toolbar" style={{ marginTop: 14 }}>
                <button className="button button--primary" onClick={() => void save()} disabled={!dirty || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="button" onClick={() => setDraft(structuredClone(channel.config))} disabled={!dirty || saving}>
                  Revert
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}
