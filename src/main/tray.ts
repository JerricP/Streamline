import { Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import type { LightingMode, LightingState } from '@shared/types'

/** 16px and 32px (@2x) PNGs, inlined so the tray never depends on a file path. */
const ICON_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAACWElEQVR4nF2TPWiUQRCGn9nd7767Sy5KwB9iFIMo+IMgiGApiKXYREQbJRgQxUYrY7z8SbCIRUAUOwmBwNWCYCMGxEYUITaijWm0MOTnvu8ud7djsXeXiwPDsDv7vjPv7K4AFItqxsfFAxSHtLeaonENocOqEborh3xcY7VUkkZrX4qoGUf8yDW9EDlGPRzxdURlO4EoaixqLb/rNV5OzPFsbAwRgJGrej6X5W29DtVNiLOgfgusgDGwWQHroKcLVjd4NDUvkzI8rNHulEUnnMnkqXfvwC3/DCS+SWIsVBLoOwhpgi+vgHFUTIVjpvcPPcDhNEUu3sDdmUZOn0PKa4iLEOuQSoLsG0BuTSBDD7A2gzHQ5XMcN3GECjSMgXwBRODSEBw6Ack61GvQVYArdyHOQU9viA0FZ6ibpsb2wBr1EIceQv+hQHhzFPb0Bxko+EYAeI+Y9qA0aG004NWTcPDy7eB9A7AwC7++QzYfzrbM0GGqkInhxxKUnsPeA3DyLHx4A4uvIc5vvx0At23VbK+wE74sgouC3k/voLsngDurtwkkXDXGBvc+tPr5fZCULzTbNSHfKmcM6uIakmSxEIaUboROVCHXFWKraCuvCiKIbxDJzKDm/mb4GjkGTATGYCspW6gOeZkciEFrFbwqXmucMvdKkhrDTD6L3Uyw5XVUfSjcdkURNC2j6TrSncV6z+zUgiyZYlHN5Jy8WE0ouoiVOEac/c8dYg0SZ5A4Q7KW8PTxvNwfHFTbfEAqIDpyXfc7z1HvUa/bf6MXNJ9BkirL0/PyrYX5B5VA+GqJN2EFAAAAAElFTkSuQmCC'
const ICON_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAE+0lEQVR4nK2Xa6hUVRTHf2vvc2bu3IfelBQVEkNRhKKHEELgpRLLDynkSD5IKK0URSz6kFbTGGoYFERBZpnlI1MiQ4IKQu1DH8y+9LB8kordMDI1770z95yzVx/2zH3Ovc7cXHBg5py91v+/1v6fddaGCqao5GZoACqVntdmKrmcBrmcmkpP+wFks2r37ZOk/P+NJdp8eYjQzcCaD6XLvW/sfgRyOTX5vLhnF+uoRssKUWYnykTnkEpkr2MqAkY4aS3fXovY+touOb43q3Z+DxJdQcvgaxforCBkW13I2CiBJBkCdBcFsBZCC1HC1WLEmo27ZFvPSgh0l+b5xTqzPuTrOIEoIRYwIogOEV8AVVTBBYYgDKBQ5MkNu2VrOWFRXymeWcDIhoCfjTAqdjgBK2XZKGiNLET8pSV/53DGoKkA217kvk27ObQ3izEv57Ag2mBYmUkxOk5IBCwKhXZ/RZ1gKmp4YPAkgY4275/EYAzGOZ+tNTwHom9fRKT0ehh3iqNByO1RgkOxcQwPL4ERo+GLHfDnecg0gEuuA2484XQaHloEw0fCp1ug7SoEYVdB2pwwZeNHcsHk8+KKJ2lKlAmJQ0QwhXZ4YB5MfxAm3wnL18P4yVBoA2MHB09iyNTDspfgnpkw5S54dFVpK0CcQ9MBjeKYDGAA0iEqUlqjHmTibaDOZ5NphIWroWE4dBYqkxDxOukswLzlMO5WiCNwDm6ZBE3NnhwlXRgh6SJQyeLIZ2QDH+Smm2HpOr8NnYXemiiDF9t9tlOn+a2ygV8XR/1FXOotAxOQHu++KZV27ARY+gLUNUAce4J+MXQWYf5KuLvFrxVTOVZfq1rbNugmkV3uq6AKQQD//gMtc2BaCdwGg4PWREAELpyBs8d94DjyJX50lSdx+RK0zPWKT2Kvjyt/w68/VEeiKgLXrsIHm6DjGgQhJJEv9dwn4N7ZMOdxrxMxfv3O1+H0L9XkX+UWpDNw5RJs3+wbiw29yKbPgkee6haYMXBgOxw7Ck3DbyABl0BdPZw5BttKlRDx99X57I2Bz9+HwwegvtHfu2EEwAdsHAanf4I9b5XKbcCVvngHP4OD+2FYc/XgNREA39+bmuHY97D/PZ+9tXDkG/hqDwwbUfp812BBbcs9QKYBvvsSzp3s3pogxLe4GmeHmgmAF12mAf743VchnfHYqrXPLgMSUO3ey0qzgHOQSuN7e4U97+U/iCYGJJCq6+73qbqBSVKBnCqEYbd/XT0DliYAKEaILS1RvOO5ExAV/aLWs6VgVUxF5fb8V6vXBviO6eI+nVH8C9A1kMSnOJIKuaMzQkUw5U8pJUJBeH3wHsFJot5vRCrtJzvjv5wdGjBlw3Y5b1pbsfm8xMCh0CKAAwhTXlzpjP9dk6knXPZP13XxcqGfJX4LxnMhm1VrxowhAZXE8E6hk3ZrMKo4VS8edbUPpOB9+vgrirMWUcfmfF7c1IuIyefF5XLIqzvkROJYEQYYY1BVYqra9aq4JApJQ4awrYMtG3bLJ7mcmvxhibsPJjM0yB+WeN1CXVaX5l2AztiP0/8H3RhMaH3HLBTZ8spOedqfQ3AgvQ+fXQeURXp/yrJalZYwoEmH0OHKXTGKabfCjy7hzfW75GN/IEEpnXf6hS2fWADWPqbjMsKkQjy07IMAAuH0i9vlfN/Yg1o2qzab1UEG8NpMUdk7QLz/ADvvOR7xZEStAAAAAElFTkSuQmCC'

function trayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(Buffer.from(ICON_16, 'base64'), { scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(ICON_32, 'base64') })
  return image
}

const QUICK_MODES: Array<{ mode: LightingMode; label: string }> = [
  { mode: 'static', label: 'Static' },
  { mode: 'breathing', label: 'Breathing' },
  { mode: 'rainbow', label: 'Rainbow' },
  { mode: 'off', label: 'Off' }
]

export interface TrayActions {
  openSettings: () => void
  openPage: (page: 'lighting' | 'drivers') => void
  applyLighting: (mode: LightingMode) => void
  quit: () => void
}

/**
 * The tray icon is Streamline's only always-present UI. Left click opens the
 * web page; the menu covers the quick actions that don't need it.
 */
export class AppTray {
  private readonly tray: Tray
  private lighting: LightingState | null

  constructor(
    private readonly actions: TrayActions,
    lighting: LightingState | null
  ) {
    this.lighting = lighting
    this.tray = new Tray(trayIcon())
    this.tray.setToolTip('Streamline')
    this.tray.on('click', () => actions.openSettings())
    this.render()
  }

  setLighting(state: LightingState): void {
    this.lighting = state
    this.render()
  }

  private render(): void {
    const current = this.lighting?.mode
    const lightingItems: MenuItemConstructorOptions[] = QUICK_MODES.map((entry) => ({
      label: entry.label,
      type: 'radio',
      checked: current === entry.mode,
      click: () => this.actions.applyLighting(entry.mode)
    }))

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Streamline', click: () => this.actions.openSettings() },
        { type: 'separator' },
        { label: 'Lighting', submenu: lightingItems },
        { label: 'Check driver updates…', click: () => this.actions.openPage('drivers') },
        { type: 'separator' },
        { label: 'Quit', click: () => this.actions.quit() }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}
