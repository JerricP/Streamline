import { useCallback, useEffect, useState } from 'react'
import type { LightingMode, LightingState, LightingStatus } from '@shared/types'
import { Toggle } from '../components/Toggle'
import { api, errorMessage } from '../lib/api'
import { useApp } from '../state/AppState'

const MODES: Array<{ mode: LightingMode; label: string; usesColor: boolean }> = [
  { mode: 'static', label: 'Static', usesColor: true },
  { mode: 'breathing', label: 'Breathing', usesColor: true },
  { mode: 'flashing', label: 'Flashing', usesColor: true },
  { mode: 'spectrum', label: 'Colour cycle', usesColor: false },
  { mode: 'rainbow', label: 'Rainbow', usesColor: false },
  { mode: 'off', label: 'Off', usesColor: false }
]

const SWATCHES = ['#ffffff', '#ff2a2a', '#ff7a00', '#ffd400', '#2aff6a', '#00c8ff', '#2a5bff', '#a12aff']

const DEFAULT_STATE: LightingState = { mode: 'static', color: '#ffffff', includeHeaders: false }

export function LightingPage() {
  const { notify } = useApp()
  const [status, setStatus] = useState<LightingStatus | null>(null)
  const [draft, setDraft] = useState<LightingState>(DEFAULT_STATE)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const next = await api.lighting.status()
      setStatus(next)
      if (next.saved) setDraft(next.saved)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const apply = async () => {
    setBusy(true)
    try {
      setStatus(await api.lighting.apply(draft))
      notify('Lighting applied', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const usesColor = MODES.find((entry) => entry.mode === draft.mode)?.usesColor ?? false
  const devices = status?.devices ?? []
  const hasHeaders = devices.some((device) => device.argbHeaders > 0)

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Lighting</h1>
          <p>Aura lighting on your ASUS motherboard, without Armoury Crate.</p>
        </div>
        <div className="toolbar">
          <button className="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Looking…' : 'Refresh'}
          </button>
        </div>
      </div>

      {status?.vendorServiceRunning && (
        <section className="panel notice">
          <strong>Armoury Crate's lighting service is still running.</strong> It talks to the same
          controller and may overwrite what you set here. Stop or disable the “LightingService” Windows
          service (or uninstall Armoury Crate) once you're happy with Streamline.
        </section>
      )}

      {!loading && devices.length === 0 ? (
        <div className="empty">
          <h2>No Aura controller found</h2>
          <p>Streamline looks for the ASUS Aura USB lighting controller on the motherboard.</p>
        </div>
      ) : (
        <>
          <section className="panel">
            <h2>Effect</h2>
            <div className="chip-row">
              {MODES.map((entry) => (
                <button
                  key={entry.mode}
                  className={`chip${draft.mode === entry.mode ? ' chip--active' : ''}`}
                  onClick={() => setDraft({ ...draft, mode: entry.mode })}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {usesColor && (
              <div className="field" style={{ marginTop: 18 }}>
                <label htmlFor="lighting-color">Colour</label>
                <div className="toolbar">
                  <input
                    id="lighting-color"
                    type="color"
                    className="input"
                    style={{ padding: 4, width: 64 }}
                    value={draft.color}
                    onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                  />
                  {SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      className={`swatch${draft.color === swatch ? ' swatch--active' : ''}`}
                      style={{ background: swatch }}
                      aria-label={swatch}
                      onClick={() => setDraft({ ...draft, color: swatch })}
                    />
                  ))}
                </div>
              </div>
            )}

            {hasHeaders && (
              <div className="row">
                <div className="row__main">
                  <div className="row__title">
                    Include ARGB headers <span className="badge">experimental</span>
                  </div>
                  <div className="row__sub">Also set fans and strips plugged into the board's addressable headers.</div>
                </div>
                <Toggle
                  checked={draft.includeHeaders}
                  label="Include ARGB headers"
                  onChange={(next) => setDraft({ ...draft, includeHeaders: next })}
                />
              </div>
            )}

            <div className="toolbar" style={{ marginTop: 12 }}>
              <button className="button button--primary" onClick={() => void apply()} disabled={busy || loading}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Controllers</h2>
            {devices.map((device) => (
              <div className="row" key={device.path}>
                <div className="row__main">
                  <div className="row__title">{device.product}</div>
                  <div className="row__sub">
                    {device.productId} · firmware {device.firmware ?? 'unknown'} · {device.mainboardLeds} onboard
                    LED{device.mainboardLeds === 1 ? '' : 's'} · {device.argbHeaders} ARGB header
                    {device.argbHeaders === 1 ? '' : 's'}
                  </div>
                  {device.configTable && (
                    <div className="row__sub" title={device.configTable}>
                      config {device.configTable}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  )
}
