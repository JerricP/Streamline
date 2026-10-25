import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { DriversPage } from './pages/DriversPage'
import { LightingPage } from './pages/LightingPage'
import { SettingsPage } from './pages/SettingsPage'
import { initialPage } from './lib/api'
import { useApp } from './state/AppState'

export type Route = 'lighting' | 'drivers' | 'settings'

const ROUTES: Route[] = ['lighting', 'drivers', 'settings']

export function App() {
  const { ready } = useApp()
  const [route, setRoute] = useState<Route>(
    ROUTES.includes(initialPage as Route) ? (initialPage as Route) : 'lighting'
  )

  return (
    <div className="app">
      <Sidebar active={route} onNavigate={setRoute} />
      <main className="content">
        {!ready ? (
          <div className="empty">
            <h2>Connecting to Streamline…</h2>
          </div>
        ) : route === 'lighting' ? (
          <LightingPage />
        ) : route === 'drivers' ? (
          <DriversPage />
        ) : (
          <SettingsPage />
        )}
      </main>
      <Toasts />
    </div>
  )
}
