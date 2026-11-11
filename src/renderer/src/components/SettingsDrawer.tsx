import { Dialog } from '@base-ui/react/dialog'
import type { ThemePreference } from '@shared/types'
import { Icon } from './Icon'
import { Segmented } from './Segmented'
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
  const patch = async (changes: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(changes)
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="drawer__scrim" />
        <Dialog.Popup className="drawer__panel">
          <header className="drawer__head">
            <Dialog.Title className="drawer__title">Settings</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close settings">
              <Icon name="close" />
            </Dialog.Close>
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
                  <span className="field__label">Theme</span>
                  <Segmented
                    label="Theme"
                    value={settings.theme}
                    options={THEMES}
                    onChange={(theme) => void patch({ theme })}
                  />
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
                  Replaces Armoury Crate lighting and ASUS DriverHub. No telemetry; the only network request is the
                  driver check to ASUS.
                </p>
              </div>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
