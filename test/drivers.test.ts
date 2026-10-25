import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReport,
  compareVersions,
  fetchCatalog,
  matchInstalled,
  modelKey,
  parseCatalog
} from '../src/main/services/drivers.ts'
import type { CatalogEntry, SystemInventory } from '../src/main/services/drivers.ts'
import type { Logger } from '../src/main/services/logger.ts'

const inventory: SystemInventory = {
  boardManufacturer: 'ASUSTeK COMPUTER INC.',
  board: 'ROG STRIX B850-I GAMING WIFI',
  biosVersion: '3040',
  entries: [
    { name: 'Advanced Micro Devices, Inc. AMD Chipset Software', version: '6.10.17.152' },
    { name: 'Realtek Realtek USB Audio', version: '6.3.9600.2389' },
    { name: 'Intel Intel(R) Ethernet Controller I226-V', version: '2.1.4.3' },
    { name: 'Contoso Toolkit', version: '1.0.0' }
  ]
}

const entry = (category: string, title: string, version: string): CatalogEntry => ({
  category,
  title,
  version,
  releaseDate: '2026/09/01',
  size: '10 MB',
  downloadUrl: 'https://dlcdnets.asus.com/x.zip'
})

test('model key matches the support-site format', () => {
  assert.equal(modelKey(' ROG STRIX B850-I GAMING WIFI '), 'ROG-STRIX-B850-I-GAMING-WIFI')
})

test('version compare ignores prefixes and padding', () => {
  assert.equal(compareVersions('V2.07.1', '2.7.1'), 0)
  assert.equal(compareVersions('3222', '3040'), 1)
  assert.equal(compareVersions('6.10.17.152', '6.10.17.152.1'), -1)
})

test('catalogue keeps the newest file per title', () => {
  const entries = parseCatalog(
    {
      Result: {
        Obj: [
          {
            Name: 'Chipset',
            Files: [
              { Title: 'AMD Chipset Driver', Version: '6.10.17.152', DownloadUrl: { Global: 'https://a' } },
              { Title: 'AMD Chipset Driver', Version: '7.01.08.129', DownloadUrl: { Global: 'https://b' } }
            ]
          }
        ]
      }
    },
    'Drivers'
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].version, '7.01.08.129')
  assert.equal(entries[0].downloadUrl, 'https://b')
})

test('BIOS files have no title; the newest released one wins and betas are skipped', () => {
  const entries = parseCatalog(
    {
      Result: {
        Obj: [
          {
            Name: 'BIOS',
            Files: [
              { Title: '', Version: '1805', IsRelease: '1' },
              { Title: '', Version: '1686', IsRelease: '0' },
              { Title: '', Version: '1900', IsRelease: '0' },
              { Title: '', Version: '0401', IsRelease: '1' }
            ]
          }
        ]
      }
    },
    'BIOS'
  )
  assert.deepEqual(
    entries.map((entry) => [entry.title, entry.version]),
    [['BIOS 1805', '1805']]
  )
})

test('BIOS compares against the SMBIOS version', () => {
  assert.equal(matchInstalled(entry('BIOS', 'ROG STRIX B850-I GAMING WIFI BIOS 3222', '3222'), inventory), '3040')
})

test('drivers match by vendor and kind', () => {
  assert.equal(matchInstalled(entry('Chipset', 'AMD Chipset Driver', '7.01.08.129'), inventory), '6.10.17.152')
  assert.equal(matchInstalled(entry('LAN', 'Intel LAN Driver', '2.1.4.3'), inventory), '2.1.4.3')
})

test('an unrelated program with the same version is not a match', () => {
  assert.equal(matchInstalled(entry('Utilities', 'Armoury Crate Install Tool', '1.0.0'), inventory), null)
})

test('report puts updates first', () => {
  const report = buildReport(
    inventory,
    [
      entry('LAN', 'Intel LAN Driver', '2.1.4.3'),
      entry('BIOS', 'BIOS 3222', '3222'),
      entry('Utilities', 'Armoury Crate Install Tool', '1.0.0')
    ],
    'Windows 11 64-bit'
  )
  assert.deepEqual(
    report.items.map((item) => item.status),
    ['update-available', 'unknown', 'up-to-date']
  )
})

test('a missing BIOS list still returns the drivers', async () => {
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger
  const original = globalThis.fetch
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input)
    if (url.includes('GetPDDrivers')) {
      return new Response(
        JSON.stringify({ Result: { Obj: [{ Name: 'LAN', Files: [{ Title: 'Intel LAN Driver', Version: '2.1.5.7' }] }] } })
      )
    }
    return new Response('Not found', { status: 404 })
  }) as typeof fetch
  try {
    const catalog = await fetchCatalog('ROG STRIX B850-I GAMING WIFI', '52', logger)
    assert.deepEqual(
      catalog.entries.map((item) => item.title),
      ['Intel LAN Driver']
    )
    assert.match(catalog.biosError ?? '', /HTTP 404/)
  } finally {
    globalThis.fetch = original
  }
})
