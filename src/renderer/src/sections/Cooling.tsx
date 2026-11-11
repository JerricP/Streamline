import { useCallback, useEffect, useState } from 'react'
import type { FanChannel, FanChannelConfig, FanCurvePoint, FanMode, FansStatus } from '@shared/types'
import { FanCurveEditor } from '../components/FanCurveEditor'
import clsx from 'clsx'
import { Icon } from '../components/Icon'
import { Segmented } from '../components/Segmented'
import { Slider } from '../components/Slider'
import { api, errorMessage } from '../lib/api'
import { usePolling } from '../lib/sensors'
import { useApp } from '../state/AppState'

const MODES: Array<{ mode: FanMode; label: string; hint: string }> = [
  {
    mode: 'bios',
    label: 'BIOS',
    hint: "The board's own Q-Fan settings decide. Same as when Streamline isn't running."
  },
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

/** AIO pumps run far faster than fans; above this a header probably drives one. */
const PUMP_RPM = 2500

const sameConfig = (a: FanChannelConfig, b: FanChannelConfig) => JSON.stringify(a) === JSON.stringify(b)

export function CoolingSection() {
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
      notify(`${draft.name ?? channel.chipName} saved`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  const monitor = status?.monitor ?? null
  const head = (
    <header className="card__head">
      <span className="card__title">
        <Icon name="fan" />
        Cooling
      </span>
      {monitor?.state === 'running' && channels.length > 0 && (
        <span className="card__meta">Changes apply within a second of saving</span>
      )}
    </header>
  )

  // Monitoring is switched on from the top of the workspace; the curves need it.
  if (monitor?.state !== 'running') {
    return (
      <section className="card" id="fans">
        {head}
        <div className="card__body">
          <p className="muted">Turn on hardware monitoring above to see and set the motherboard's fan headers.</p>
        </div>
      </section>
    )
  }

  const dirty = channel && draft ? !sameConfig(channel.config, draft) : false
  const lowestDuty = draft
    ? draft.mode === 'fixed'
      ? draft.fixedDuty
      : Math.min(...draft.points.map((point) => point.duty))
    : 100
  const cpuFanTooLow =
    channel && draft && draft.mode !== 'bios' && /cpu/i.test(channel.name) && lowestDuty < CPU_FAN_FLOOR
  const looksLikePump = channel && draft && draft.mode !== 'bios' && (channel.rpm ?? 0) > PUMP_RPM
  const source = status?.temperatures.find((entry) => entry.id === draft?.sourceId)

  return (
    <section className="card" id="fans">
      {head}
      {channels.length === 0 ? (
        <div className="card__body">
          <div className="empty">
            <h2>No controllable fans found</h2>
            <p>The motherboard's sensor chip didn't report any fan headers. Check the notice above.</p>
          </div>
        </div>
      ) : (
        <div className="fans">
          <div className="fans__list">
            {channels.map((entry) => (
              <button
                key={entry.controlId}
                className={clsx('fan-card', entry.controlId === channel?.controlId && 'fan-card--active')}
                onClick={() => setSelected(entry.controlId)}
              >
                <div className="fan-card__top">
                  <span className="fan-card__name">{entry.name}</span>
                  <span className={clsx('badge', entry.config.mode !== 'bios' && 'badge--accent')}>
                    {entry.stalled ? 'stopped' : MODES.find((mode) => mode.mode === entry.config.mode)?.label}
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
            <div className="fans__editor">
              <div className="fans__editor-head">
                <input
                  className="input fans__name"
                  aria-label="Fan name"
                  maxLength={40}
                  placeholder={channel.chipName}
                  value={draft.name ?? ''}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value || null })}
                />
                <div className="fans__live">
                  {channel.sourceTemp !== null && draft.mode === 'curve' && (
                    <span>{channel.sourceTemp.toFixed(1)}°C</span>
                  )}
                  <span>{channel.duty === null ? '—' : `${Math.round(channel.duty)}%`}</span>
                  <span>{channel.rpm === null ? 'no RPM' : `${Math.round(channel.rpm)} RPM`}</span>
                </div>
              </div>

              <p className="muted">
                On the board as “{channel.chipName}”. Rename it to what's plugged in, e.g. “AIO fans”.
              </p>

              {!channel.controllable && (
                <p className="note note--warn">
                  Streamline can read this fan but can't set its speed safely on this board yet, so it stays on the BIOS
                  curve. You can still rename it.
                </p>
              )}
              {channel.chipCurve && (
                <p className="note">
                  Saved curves are written into the fan chip, the way Armoury Crate does it, and keep running even when
                  Streamline is closed. BIOS puts back the curve that was there before.
                </p>
              )}
              {channel.stalled && (
                <p className="note note--warn">
                  This fan stopped spinning when Streamline set its speed, so it was handed back to the BIOS. Save again
                  to retry.
                </p>
              )}

              <Segmented
                label="Fan mode"
                value={draft.mode}
                options={MODES.map((entry) => ({
                  value: entry.mode,
                  label: entry.label,
                  disabled: !channel.controllable && entry.mode !== 'bios'
                }))}
                onChange={(mode) =>
                  setDraft({
                    ...draft,
                    mode,
                    sourceId: draft.sourceId ?? status?.temperatures[0]?.id ?? null
                  })
                }
              />
              <p className="muted">{MODES.find((entry) => entry.mode === draft.mode)?.hint}</p>

              {draft.mode === 'fixed' && (
                <div className="field">
                  <label id="fixed-duty">
                    Speed <span className="field__value">{draft.fixedDuty}%</span>
                  </label>
                  <Slider
                    labelId="fixed-duty"
                    value={draft.fixedDuty}
                    onChange={(next) => setDraft({ ...draft, fixedDuty: next })}
                  />
                </div>
              )}

              {draft.mode === 'curve' && (
                <>
                  <div className="toolbar" style={{ marginBottom: 14 }}>
                    {channel.chipCurve ? (
                      <span className="field__inline">Follows the fan chip's own CPU temperature</span>
                    ) : (
                      <>
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
                      </>
                    )}
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
                    currentTemp={channel.chipCurve ? channel.sourceTemp : (source?.value ?? null)}
                    currentDuty={dirty ? null : channel.target}
                  />
                </>
              )}

              {draft.mode !== 'bios' && (
                <div className="field">
                  <label id="min-duty">
                    Never slower than <span className="field__value">{draft.minDuty}%</span>
                  </label>
                  <Slider
                    labelId="min-duty"
                    value={draft.minDuty}
                    onChange={(next) => setDraft({ ...draft, minDuty: next })}
                  />
                  <span className="field__hint">A floor under the curve or fixed speed. Pumps usually want 100%.</span>
                </div>
              )}

              {looksLikePump && (
                <p className="note note--warn">
                  This header spins at over {PUMP_RPM} RPM, which is typical of an AIO pump. A slow or stopped pump
                  overheats the CPU quickly; leave it on BIOS or set “Never slower than” high.
                </p>
              )}

              {cpuFanTooLow && (
                <p className="note note--warn">
                  CPU fans below {CPU_FAN_FLOOR}% can stall, and the BIOS may report a CPU fan error at boot.
                </p>
              )}

              <div className="actions">
                <button className="button button--primary" onClick={() => void save()} disabled={!dirty || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="button"
                  onClick={() => setDraft(structuredClone(channel.config))}
                  disabled={!dirty || saving}
                >
                  Revert
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
