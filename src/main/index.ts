import { join } from 'node:path'
import { app, powerMonitor, shell } from 'electron'
import type { LightingMode, Settings } from '@shared/types'
import { createHandlers } from './handlers'
import { AuraService } from './services/aura'
import { Logger } from './services/logger'
import { Paths } from './services/paths'
import { SensorService } from './services/sensors'
import { Store } from './store'
import { AppTray } from './tray'
import { startWebServer } from './webServer'
import type { WebServer } from './webServer'

/** Passed by the Windows login item so a sign-in doesn't pop a browser tab. */
const BACKGROUND_FLAG = '--background'

const DEFAULT_COLOR = '#ffffff'

// One instance owns the controller, the database and the web server.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setAppUserModelId('com.jerricp.streamline')

  let server: WebServer | null = null
  let tray: AppTray | null = null
  let store: Store | null = null
  let sensors: SensorService | null = null

  const openPage = (page?: 'overview' | 'fans' | 'lighting' | 'drivers') => {
    if (!server) return
    // In development the UI comes from the Vite dev server, which proxies /api.
    const devServerUrl = process.env['ELECTRON_RENDERER_URL']
    const url = devServerUrl ? `${devServerUrl}#${server.url.split('#')[1]}` : server.url
    void shell.openExternal(page ? `${url}&page=${page}` : url)
  }

  const syncLoginItem = (settings: Settings) => {
    // Registering the dev Electron binary at login would be wrong; only the installed app.
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, args: [BACKGROUND_FLAG] })
  }

  app.on('second-instance', () => openPage())

  // There is no window; the tray keeps the app alive until Quit.
  app.on('window-all-closed', () => undefined)

  app.whenReady().then(async () => {
    const paths = new Paths(join(app.getPath('userData'), 'StreamlineData'))
    const logger = new Logger(paths.logs)
    const activeStore = new Store(paths)
    store = activeStore
    logger.info('app', `Streamline ${app.getVersion()} starting (data: ${paths.root})`)

    const aura = new AuraService(logger)
    // Packaged: next to app.asar. Development: the repo's resources folder.
    const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const activeSensors = new SensorService({
      logger,
      helperPaths: { script: join(resources, 'sensors', 'StreamlineSensors.ps1'), libDir: join(resources, 'lhm') },
      simulate: process.env['STREAMLINE_SIMULATE_SENSORS'] === '1',
      fanConfigs: () => activeStore.snapshot.fans,
      chipOriginals: () => activeStore.snapshot.chipOriginals,
      saveChipOriginal: (controlId, points) =>
        activeStore.mutate((db) => {
          db.chipOriginals = { ...db.chipOriginals, [controlId]: points }
        })
    })
    sensors = activeSensors
    const handlers = createHandlers({
      paths,
      store: activeStore,
      logger,
      aura,
      sensors: activeSensors,
      onSettingsChanged: syncLoginItem,
      onLightingChanged: (state) => tray?.setLighting(state)
    })

    server = await startWebServer(join(__dirname, '../renderer'), handlers, logger)

    const applyFromTray = (mode: LightingMode) => {
      const previous = activeStore.snapshot.lighting
      const state = { mode, color: previous?.color ?? DEFAULT_COLOR, includeHeaders: previous?.includeHeaders ?? false }
      aura
        .apply(state)
        .then(() => {
          activeStore.mutate((db) => {
            db.lighting = state
          })
          tray?.setLighting(state)
        })
        .catch((error) => logger.warn('aura', `Tray apply failed: ${String(error)}`))
    }

    tray = new AppTray(
      {
        openSettings: () => openPage(),
        openPage,
        applyLighting: applyFromTray,
        quit: () => app.quit()
      },
      activeStore.snapshot.lighting
    )

    syncLoginItem(activeStore.settings)

    // The controller keeps its last effect on most boards, but re-applying
    // covers boards that fall back to the BIOS default on a cold boot.
    const saved = activeStore.snapshot.lighting
    if (saved) aura.apply(saved).catch((error) => logger.warn('aura', `Start-up apply skipped: ${String(error)}`))

    // Armoury Crate's fan service puts its own chip curves back on resume.
    powerMonitor.on('resume', () => {
      setTimeout(() => void activeSensors.applyChipCurves(), 10_000)
    })

    if (activeStore.snapshot.monitoringEnabled) {
      activeSensors.start().catch((error) => logger.warn('sensors', `Start-up monitoring skipped: ${String(error)}`))
    }

    if (!process.argv.includes(BACKGROUND_FLAG)) openPage()
  })

  app.on('before-quit', () => {
    // Closing the helper hands every fan back to the BIOS.
    sensors?.stop()
    store?.flushNow()
    tray?.destroy()
    void server?.close()
  })
}
