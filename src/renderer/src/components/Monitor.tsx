import { useState } from 'react'
import type { MonitorStatus } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { PAWNIO_URL } from '../lib/sensors'
import { useApp } from '../state/AppState'

/** Shown while monitoring is off: what turning it on involves, and the button. */
export function MonitorOff({ monitor, onStarted }: { monitor: MonitorStatus | null; onStarted: () => void }) {
  const { notify } = useApp()
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setStarting(true)
    try {
      await api.sensors.start()
      notify('Monitoring started', 'success')
      onStarted()
    } catch (error) {
      notify(errorMessage(error), 'error')
      onStarted()
    } finally {
      setStarting(false)
    }
  }

  const busy = starting || monitor?.state === 'starting'

  return (
    <section className="panel">
      <h2>Hardware monitoring is off</h2>
      <p className="panel__text">
        Temperatures, fan speeds and fan control come from the motherboard's sensor chip. Reading it needs
        administrator rights, so Windows will ask for permission when you turn this on. It also needs the free, signed{' '}
        <strong>PawnIO</strong> driver that LibreHardwareMonitor uses.
      </p>
      {monitor?.state === 'error' && monitor.message && <p className="panel__text panel__text--error">{monitor.message}</p>}
      <div className="toolbar">
        <button className="button button--primary" onClick={() => void start()} disabled={busy}>
          {busy ? 'Waiting for Windows…' : 'Turn on monitoring'}
        </button>
        <button className="button" onClick={() => void api.shell.openExternal(PAWNIO_URL)}>
          Get PawnIO
        </button>
      </div>
    </section>
  )
}

/** Problems that leave monitoring half working, or fighting another app. */
export function MonitorNotices({ monitor }: { monitor: MonitorStatus | null }) {
  if (!monitor || monitor.state !== 'running') return null
  return (
    <>
      {monitor.simulated && (
        <section className="panel notice">
          <strong>Simulated sensors.</strong> These readings are made up for development
          (STREAMLINE_SIMULATE_SENSORS=1).
        </section>
      )}
      {monitor.message && (
        <section className="panel notice">
          <strong>{monitor.message}</strong>{' '}
          {monitor.driverInstalled === false && (
            <>
              Install PawnIO from <a onClick={() => void api.shell.openExternal(PAWNIO_URL)}>pawnio.eu</a> (or run{' '}
              <code>winget install namazso.PawnIO</code>), then turn monitoring off and on again.
            </>
          )}
        </section>
      )}
      {monitor.vendorFanServiceRunning && (
        <section className="panel notice">
          <strong>Armoury Crate's fan service is still running.</strong> It sets the same fans and can undo your curves.
          Stop or disable the “AsusFanControlService” Windows service (or uninstall Armoury Crate) once you're happy
          with Streamline's fan control.
        </section>
      )}
    </>
  )
}
