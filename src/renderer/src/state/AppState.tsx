import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppInfo, Settings } from '@shared/types'
import { api, errorMessage } from '../lib/api'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface AppStateValue {
  ready: boolean
  appInfo: AppInfo | null
  settings: Settings | null
  toasts: Toast[]
  notify: (text: string, kind?: Toast['kind']) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToastId = useRef(0)

  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = (nextToastId.current += 1)
    setToasts((previous) => [...previous, { id, kind, text }])
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id))
    }, 5200)
  }, [])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await api.settings.update(patch))
  }, [])

  useEffect(() => {
    Promise.all([api.app.info(), api.settings.get()])
      .then(([info, nextSettings]) => {
        setAppInfo(info)
        setSettings(nextSettings)
      })
      .catch((error) => notify(errorMessage(error), 'error'))
      .finally(() => setReady(true))
  }, [notify])

  // Reflect the chosen theme and accent as CSS custom properties.
  useEffect(() => {
    const root = document.documentElement
    if (settings?.accent) root.style.setProperty('--accent', settings.accent)
    const preference = settings?.theme ?? 'dark'
    const resolved =
      preference === 'system'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : preference
    root.dataset.theme = resolved
  }, [settings?.theme, settings?.accent])

  const value = useMemo<AppStateValue>(
    () => ({ ready, appInfo, settings, toasts, notify, updateSettings }),
    [ready, appInfo, settings, toasts, notify, updateSettings]
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useApp(): AppStateValue {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useApp must be used inside an AppStateProvider')
  return context
}
