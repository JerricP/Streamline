import type { ThemePreference } from '@shared/types'
import { Toggle } from '../components/Toggle'
import { errorMessage } from '../lib/api'
import { useApp } from '../state/AppState'

const THEMES: ThemePreference[] = ['dark', 'light', 'system']

export function SettingsPage() {
  const { settings, appInfo, updateSettings, notify } = useApp()

  if (!settings) {
    return (
      <div className="empty">
        <h2>Loading settings…</h2>
      </div>
    )
  }

  const patch = async (changes: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(changes)
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>How Streamline looks and starts.</p>
        </div>
      </div>

      <section className="panel">
        <h2>Startup</h2>
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
      </section>

      <section className="panel">
        <h2>Appearance</h2>
        <div className="field">
          <label htmlFor="theme">Theme</label>
          <select
            id="theme"
            className="select"
            value={settings.theme}
            onChange={(event) => void patch({ theme: event.target.value as ThemePreference })}
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="accent">Accent colour</label>
          <div className="toolbar">
            <input
              id="accent"
              type="color"
              className="input"
              style={{ padding: 4, width: 64 }}
              value={settings.accent}
              onChange={(event) => void patch({ accent: event.target.value })}
            />
            <span style={{ color: 'var(--text-dim)' }}>{settings.accent}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>About</h2>
        <div className="row">
          <div className="row__main">
            <div className="row__title">Streamline {appInfo?.version ?? ''}</div>
            <div className="row__sub">
              Electron {appInfo?.electron} · Node {appInfo?.node} · {appInfo?.platform}
            </div>
            <div className="row__sub" title={appInfo?.dataDir}>
              Data and logs: {appInfo?.dataDir ?? '—'}
            </div>
          </div>
        </div>
        <p style={{ color: 'var(--text-faint)', marginBottom: 0 }}>
          Replaces Armoury Crate lighting and ASUS DriverHub. No telemetry; the only network request is the
          driver check to ASUS.
        </p>
      </section>
    </>
  )
}
