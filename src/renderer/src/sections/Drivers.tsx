import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import type { DriverItem, DriverReport, DriverStatus } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { useApp } from '../state/AppState'

const STATUS_LABEL: Record<DriverStatus, string> = {
  'update-available': 'Update available',
  unknown: 'Not found',
  'up-to-date': 'Up to date'
}

function formatCheckedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function DriverRow({ item, onDownload }: { item: DriverItem; onDownload: (item: DriverItem) => void }) {
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__title">
          {item.title} <span className={`badge status--${item.status}`}>{STATUS_LABEL[item.status]}</span>
        </div>
        <div className="row__sub">
          {item.category} · latest {item.latestVersion}
          {item.installedVersion ? ` · installed ${item.installedVersion}` : ''}
          {item.releaseDate ? ` · ${item.releaseDate}` : ''}
          {item.size ? ` · ${item.size}` : ''}
        </div>
      </div>
      <div className="row__actions">
        {item.downloadUrl && item.status !== 'up-to-date' && (
          <button className="button button--small" onClick={() => onDownload(item)}>
            Download
            <Icon name="external" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

export function DriversSection({ onReport }: { onReport?: (report: DriverReport | null) => void }) {
  const { notify } = useApp()
  const [report, setReport] = useState<DriverReport | null>(null)
  const [checking, setChecking] = useState(false)

  // Let the workspace's top bar show how many updates are waiting.
  useEffect(() => {
    onReport?.(report)
  }, [report, onReport])

  useEffect(() => {
    api.drivers
      .last()
      .then(setReport)
      .catch(() => undefined)
  }, [])

  const check = async () => {
    setChecking(true)
    try {
      const next = await api.drivers.check()
      setReport(next)
      const updates = next.items.filter((item) => item.status === 'update-available').length
      notify(updates === 0 ? 'Everything ASUS lists is up to date' : `${updates} update(s) available`, 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setChecking(false)
    }
  }

  const download = (item: DriverItem) => {
    if (item.downloadUrl)
      void api.shell.openExternal(item.downloadUrl).catch((error) => notify(errorMessage(error), 'error'))
  }

  const updates = report?.items.filter((item) => item.status === 'update-available') ?? []
  const upToDate = report?.items.filter((item) => item.status === 'up-to-date') ?? []
  const notFound = report?.items.filter((item) => item.status === 'unknown') ?? []
  const row = (item: DriverItem) => (
    <DriverRow key={`${item.category}|${item.title}`} item={item} onDownload={download} />
  )

  return (
    <section className="card" id="drivers">
      <header className="card__head">
        <span className="card__title">
          <Icon name="drivers" />
          Drivers
        </span>
        <button className="button button--small" onClick={() => void check()} disabled={checking}>
          <span className={checking ? 'spin' : undefined}>
            <Icon name="refresh" size={13} />
          </span>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </header>

      <div className="card__body">
        {!report ? (
          <div className="empty">
            <h2>Not checked yet</h2>
            <p>Compare what's installed with ASUS's download page for your motherboard, including the BIOS.</p>
          </div>
        ) : (
          <>
            <div className={`summary${updates.length > 0 ? ' summary--attention' : ''}`}>
              <span className="summary__icon">
                <Icon name={updates.length > 0 ? 'drivers' : 'check'} size={18} />
              </span>
              <div className="row__main">
                <div className="row__title">
                  {updates.length > 0
                    ? `${updates.length} update${updates.length === 1 ? '' : 's'} available`
                    : 'Everything is up to date'}
                </div>
                <div className="row__sub" title={report.board}>
                  {report.board} · BIOS {report.biosVersion ?? 'unknown'} · {report.os}
                </div>
                <div className="row__sub">Checked {formatCheckedAt(report.checkedAt)}</div>
              </div>
            </div>

            {report.biosError && (
              <p className="note note--warn">
                <strong>BIOS updates couldn't be checked.</strong> {report.biosError} Driver results below are still
                current. Check the BIOS on ASUS's support page for now.
              </p>
            )}

            {updates.map(row)}

            {upToDate.length > 0 && (
              <details className="fold">
                <summary>Up to date on this PC ({upToDate.length})</summary>
                {upToDate.map(row)}
              </details>
            )}
            {updates.length === 0 && upToDate.length === 0 && (
              <p className="muted">None of ASUS's packages matched an installed driver.</p>
            )}

            {notFound.length > 0 && (
              <details className="fold">
                <summary>Not found on this PC ({notFound.length})</summary>
                {notFound.map(row)}
                <p className="fine-print">
                  “Not found” means ASUS lists the package for your board but Streamline couldn't match it to anything
                  installed, often because that hardware or optional software isn't on this PC.
                </p>
              </details>
            )}
            <p className="fine-print">Installers open in your browser; Streamline never runs them for you.</p>
          </>
        )}
      </div>
    </section>
  )
}
