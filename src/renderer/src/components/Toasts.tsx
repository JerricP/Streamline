import { Toaster } from 'sonner'
import { useApp } from '../state/AppState'

/** Notifications, rendered by Sonner. `notify()` in AppState is what raises them. */
export function Toasts() {
  const { settings } = useApp()
  return (
    <Toaster
      theme={settings?.theme ?? 'dark'}
      position="bottom-right"
      duration={5200}
      toastOptions={{ className: 'toast' }}
    />
  )
}
