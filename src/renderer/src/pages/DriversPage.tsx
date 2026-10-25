import { useEffect, useState } from 'react'
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
          <button className="button" onClick={() => onDownload(item)}>
            Download
          </button>
        )}
      </div>
    </div>
  )
}

export function DriversPage() {
  const { notify } = useApp()
  const [report, setReport] = useState<DriverReport | null>(null)
  const [checking, setChecking] = useState(false)

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
    if (item.downloadUrl) void api.shell.openExternal(item.downloadUrl).catch((error) => notify(errorMessage(error), 'error'))
  }

  const updates = report?.items.filter((item) => item.status === 'update-available').length ?? 0
  const installed = report?.items.filter((item) => item.status !== 'unknown') ?? []
  const notFound = report?.items.filter((item) => item.status === 'unknown') ?? []

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Drivers</h1>
          <p>Compares what's installed with ASUS's download page for your motherboard.</p>
        </div>
        <div className="toolbar">
          <button className="button button--primary" onClick={() => void check()} disabled={checking}>
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      </div>

      {!report ? (
        <div className="empty">
          <h2>Not checked yet</h2>
          <p>Run a check to see BIOS and driver updates for your board.</p>
        </div>
      ) : (
        <>
          <section className="panel">
            <div className="row">
              <div className="row__main">
                <div className="row__title">{report.board}</div>
                <div className="row__sub">
                  BIOS {report.biosVersion ?? 'unknown'} · {report.os} · checked {formatCheckedAt(report.checkedAt)}
                </div>
              </div>
              <span className={`badge${updates > 0 ? ' badge--accent' : ''}`}>
                {updates > 0 ? `${updates} update${updates === 1 ? '' : 's'}` : 'Up to date'}
              </span>
            </div>
          </section>

          {report.biosError && (
            <section className="panel notice">
              <strong>BIOS updates couldn't be checked.</strong> {report.biosError} Driver results below are
              still current. Check the BIOS on ASUS's support page for now.
            </section>
          )}

          <section className="panel">
            <h2>On this PC</h2>
            {installed.length === 0 ? (
              <p className="row__sub">None of ASUS's packages matched an installed driver.</p>
            ) : (
              installed.map((item) => <DriverRow key={`${item.category}|${item.title}`} item={item} onDownload={download} />)
            )}
          </section>

          {notFound.length > 0 && (
            <details className="panel">
              <summary className="panel__summary">Not found on this PC ({notFound.length})</summary>
              {notFound.map((item) => (
                <DriverRow key={`${item.category}|${item.title}`} item={item} onDownload={download} />
              ))}
            </details>
          )}
          <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            “Not found” means ASUS lists the package for your board but Streamline couldn't match it to anything
            installed, often because that hardware or optional software isn't on this PC. Installers open in your
            browser; Streamline never runs them for you.
          </p>
        </>
      )}
    </>
  )
}
