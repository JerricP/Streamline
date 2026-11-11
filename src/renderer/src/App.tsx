import clsx from 'clsx'
import { useCallback, useEffect, useState } from 'react'
import type { DriverReport } from '@shared/types'
import { Icon } from './components/Icon'
import type { IconName } from './components/Icon'
import { SettingsDrawer } from './components/SettingsDrawer'
import { Toasts } from './components/Toasts'
import { CoolingSection } from './sections/Cooling'
import { DriversSection } from './sections/Drivers'
import { LightingSection } from './sections/Lighting'
import { SensorsSection, Vitals } from './sections/Sensors'
import { initialPage } from './lib/api'
import { useApp } from './state/AppState'
import { useSensors } from './state/useSensors'

/** Jump links to the parts of the one workspace. The ids match the tray's `page=` deep links. */
const JUMPS: Array<{ id: string; label: string; icon: IconName }> = [
  { id: 'fans', label: 'Cooling', icon: 'fan' },
  { id: 'lighting', label: 'Lighting', icon: 'light' },
  { id: 'drivers', label: 'Drivers', icon: 'drivers' },
  { id: 'sensors', label: 'Sensors', icon: 'sensors' }
]

function jumpTo(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  if (target instanceof HTMLDetailsElement) target.open = true
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function App() {
  const { ready } = useApp()
  const sensors = useSensors()
  const [settingsOpen, setSettingsOpen] = useState(initialPage === 'settings')
  const [drivers, setDrivers] = useState<DriverReport | null>(null)
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // Honour the tray's deep link (e.g. "Check drivers…") once the workspace is on screen.
  useEffect(() => {
    const page = initialPage
    if (ready && page && page !== 'settings' && page !== 'overview') {
      window.setTimeout(() => jumpTo(page), 150)
    }
  }, [ready])

  const monitoring = sensors.status?.monitor?.state === 'running'
  const updates = drivers?.items.filter((item) => item.status === 'update-available').length ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden />
            Streamline
          </div>

          <nav className="jumps" aria-label="Sections">
            {JUMPS.map((jump) => (
              <button
                key={jump.id}
                className="jumps__item"
                onClick={() => jumpTo(jump.id)}
                disabled={!ready || (jump.id === 'sensors' && !monitoring)}
              >
                <Icon name={jump.icon} size={14} />
                <span>{jump.label}</span>
              </button>
            ))}
          </nav>

          <div className="topbar__status">
            <span className={clsx('pill', monitoring && 'pill--live')} title="Hardware monitoring">
              <span className="pill__dot" aria-hidden />
              {monitoring ? 'Monitoring' : 'Monitoring off'}
            </span>
            {updates > 0 && (
              <button className="pill pill--accent" onClick={() => jumpTo('drivers')}>
                {updates} update{updates === 1 ? '' : 's'}
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
            >
              <Icon name="settings" size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {!ready ? (
          <div className="connecting">
            <span className="brand__mark brand__mark--pulse" aria-hidden />
            Connecting to Streamline…
          </div>
        ) : (
          <div className="workspace">
            <Vitals sensors={sensors} />
            <div className="workspace__grid">
              <div className="workspace__main">
                <CoolingSection />
              </div>
              <div className="workspace__side">
                <LightingSection />
                <DriversSection onReport={setDrivers} />
              </div>
            </div>
            <SensorsSection sensors={sensors} />
          </div>
        )}
      </main>

      <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
      <Toasts />
    </div>
  )
}
