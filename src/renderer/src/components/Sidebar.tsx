import type { Route } from '../App'

interface NavEntry {
  key: Route
  label: string
  glyph: string
}

const ENTRIES: NavEntry[] = [
  { key: 'overview', label: 'Overview', glyph: '◉' },
  { key: 'fans', label: 'Fans', glyph: '✣' },
  { key: 'lighting', label: 'Lighting', glyph: '✦' },
  { key: 'drivers', label: 'Drivers', glyph: '↻' },
  { key: 'settings', label: 'Settings', glyph: '⚙' }
]

export function Sidebar({ active, onNavigate }: { active: Route; onNavigate: (route: Route) => void }) {
  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__dot" />
        Streamline
      </div>
      {ENTRIES.map((entry) => (
        <button
          key={entry.key}
          className={`nav-item${active === entry.key ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate(entry.key)}
        >
          <span aria-hidden>{entry.glyph}</span>
          <span>{entry.label}</span>
        </button>
      ))}
    </nav>
  )
}
