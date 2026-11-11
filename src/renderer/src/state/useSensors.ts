import { useCallback, useRef, useState } from 'react'
import type { SensorsStatus } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { usePolling } from '../lib/sensors'
import { useApp } from './AppState'

const HISTORY = 90

/**
 * Live sensor readings for the workspace, polled once a second, with a short
 * history per sensor for the sparklines. Same calls the old Overview page made.
 */
export function useSensors() {
  const { notify } = useApp()
  const [status, setStatus] = useState<SensorsStatus | null>(null)
  const history = useRef(new Map<string, number[]>())

  const refresh = useCallback(async () => {
    try {
      const next = await api.sensors.status()
      for (const hw of next.snapshot?.hardware ?? []) {
        for (const sensor of hw.sensors) {
          if (sensor.value === null) continue
          const list = history.current.get(sensor.id) ?? []
          list.push(sensor.value)
          if (list.length > HISTORY) list.shift()
          history.current.set(sensor.id, list)
        }
      }
      setStatus(next)
    } catch (error) {
      notify(errorMessage(error), 'error')
      throw error
    }
  }, [notify])

  usePolling(refresh, 1000)

  const stop = useCallback(async () => {
    try {
      setStatus(await api.sensors.stop())
      notify('Monitoring stopped; fans are back under BIOS control')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }, [notify])

  return { status, history: history.current, refresh, stop }
}

export type SensorsState = ReturnType<typeof useSensors>
