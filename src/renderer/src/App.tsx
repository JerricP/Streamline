import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { DriversPage } from './pages/DriversPage'
import { FansPage } from './pages/FansPage'
import { LightingPage } from './pages/LightingPage'
import { OverviewPage } from './pages/OverviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { initialPage } from './lib/api'
import { useApp } from './state/AppState'

export type Route = 'overview' | 'fans' | 'lighting' | 'drivers' | 'settings'

const ROUTES: Route[] = ['overview', 'fans', 'lighting', 'drivers', 'settings']

export function App() {
  const { ready } = useApp()
  const [route, setRoute] = useState<Route>(
    ROUTES.includes(initialPage as Route) ? (initialPage as Route) : 'overview'
  )

  return (
    <div className="app">
      <Sidebar active={route} onNavigate={setRoute} />
      <main className="content">
        {!ready ? (
          <div className="empty">
            <h2>Connecting to Streamline…</h2>
          </div>
        ) : route === 'overview' ? (
          <OverviewPage />
        ) : route === 'fans' ? (
          <FansPage />
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
