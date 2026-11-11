import { useEffect, useRef } from 'react'
import type { ThemePreference } from '@shared/types'
import { Icon } from './Icon'
import { Toggle } from './Toggle'
import { errorMessage } from '../lib/api'
import { useApp } from '../state/AppState'

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' }
]

/** App preferences, in a panel that slides over the workspace instead of a page of its own. */
export function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, appInfo, updateSettings, notify } = useApp()
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const patch = async (changes: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(changes)
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <div className={`drawer${open ? ' drawer--open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="drawer__scrim" onClick={onClose} />
      <aside className="drawer__panel" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={panel}>
        <header className="drawer__head">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </header>

        {!settings ? (
          <p className="muted">Loading settings…</p>
        ) : (
          <>
            <div className="drawer__group">
              <div className="drawer__label">Startup</div>
              <div className="row">
                <div className="row__main">
                  <div className="row__title">Start with Windows</div>
                  <div className="row__sub">Sit in the tray from sign-in and re-apply your lighting.</div>
                </div>
                <Toggle
                  checked={settings.startWithWindows}
                  label="Start with Windows"
                  onChange={(next) => void patch({ startWithWindows: next })}
                />
              </div>
            </div>

            <div className="drawer__group">
              <div className="drawer__label">Appearance</div>
              <div className="field">
                <label>Theme</label>
                <div className="segmented" role="radiogroup" aria-label="Theme">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.value}
                      role="radio"
                      aria-checked={settings.theme === theme.value}
                      className={`segmented__item${settings.theme === theme.value ? ' segmented__item--active' : ''}`}
                      onClick={() => void patch({ theme: theme.value })}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="accent">Accent colour</label>
                <div className="toolbar">
                  <label className="swatch swatch--custom swatch--filled" style={{ background: settings.accent }}>
                    <input
                      id="accent"
                      type="color"
                      value={settings.accent}
                      onChange={(event) => void patch({ accent: event.target.value })}
                    />
                  </label>
                  <span className="mono muted">{settings.accent}</span>
                </div>
              </div>
            </div>

            <div className="drawer__group">
              <div className="drawer__label">About</div>
              <div className="row__title">Streamline {appInfo?.version ?? ''}</div>
              <div className="row__sub">
                Electron {appInfo?.electron} · Node {appInfo?.node} · {appInfo?.platform}
              </div>
              <div className="row__sub" title={appInfo?.dataDir}>
                Data and logs: {appInfo?.dataDir ?? '—'}
              </div>
              <p className="fine-print">
                Replaces Armoury Crate lighting and ASUS DriverHub. No telemetry; the only network request is the driver
                check to ASUS.
              </p>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
