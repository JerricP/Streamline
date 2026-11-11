/** A small set of line icons, drawn on a 24px grid with the current text colour. */
const PATHS = {
  fan: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0 M12 10c0-4 1-7 4-7 2 0 3 2 2 4l-2 3 M14 12c4 0 7 1 7 4 0 2-2 3-4 2l-3-2 M12 14c0 4-1 7-4 7-2 0-3-2-2-4l2-3 M10 12c-4 0-7-1-7-4 0-2 2-3 4-2l3 2',
  light: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  drivers: 'M12 3v12 M7 10l5 5 5-5 M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  sensors: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M15 10v4 M11 16v4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  close: 'M6 6l12 12 M18 6L6 18',
  refresh: 'M20 11a8 8 0 0 0-14.8-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14.8 4l1.2-2 M20 20v-5h-5',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  power: 'M12 2v10 M18.4 6.6a9 9 0 1 1-12.8 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-4.3-4.3',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
