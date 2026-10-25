import { useApp } from '../state/AppState'

export function Toasts() {
  const { toasts } = useApp()
  if (toasts.length === 0) return null

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          {toast.text}
        </div>
      ))}
    </div>
  )
}
