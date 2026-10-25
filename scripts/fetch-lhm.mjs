// Downloads LibreHardwareMonitorLib and the .NET Framework 4.7.2 builds of its
// dependencies from nuget.org into resources/lhm/, for the sensor helper.
//
// Windows PowerShell 5.1 (on every Windows 10/11 PC) runs on .NET Framework,
// so it can load these DLLs directly; no .NET SDK is needed to build or run.
//
//   node scripts/fetch-lhm.mjs          fetch if resources/lhm is missing or stale
//   node scripts/fetch-lhm.mjs --force  always fetch

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const ROOT_PACKAGE = 'LibreHardwareMonitorLib'
const ROOT_VERSION = '0.9.6'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'lhm')
const STAMP = join(OUT_DIR, 'VERSION')

/** Dependency groups to read, most specific first. */
const GROUPS = ['.NETFramework4.7.2', '.NETFramework4.7.1', '.NETFramework4.7', '.NETFramework4.6.2', '.NETFramework4.6.1', '.NETFramework4.6', '.NETFramework4.5', '.NETStandard2.0']
/** Library folders to take DLLs from, most specific first. */
const FOLDERS = ['net472', 'net471', 'net47', 'net462', 'net461', 'net46', 'net45', 'netstandard2.0']

// ---- Zip reading (just enough for .nupkg) ---------------------------------

function unzip(buffer) {
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('Not a zip file')
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const files = new Map()
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const local = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const data = buffer.subarray(dataStart, dataStart + compressedSize)
    files.set(decodeURIComponent(name), () => (method === 0 ? data : inflateRawSync(data)))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

// ---- NuGet ------------------------------------------------------------------

async function download(id, version) {
  const lower = id.toLowerCase()
  const url = `https://api.nuget.org/v3-flatcontainer/${lower}/${version}/${lower}.${version}.nupkg`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** `[1.0.0, )` and `1.0.0` both mean "1.0.0 or later"; nuget resolves the lowest. */
function lowestVersion(range) {
  return range.replace(/[[\]() ]/g, '').split(',')[0]
}

function dependencies(nuspec) {
  const groups = [...nuspec.matchAll(/<group targetFramework="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/group>)/g)]
  const match = GROUPS.map((framework) => groups.find((group) => group[1] === framework)).find(Boolean)
  const body = match ? (match[2] ?? '') : groups.length === 0 ? nuspec : ''
  return [...body.matchAll(/<dependency id="([^"]+)" version="([^"]+)"/g)].map((dep) => ({
    id: dep[1],
    version: lowestVersion(dep[2])
  }))
}

function libraryFiles(files) {
  const names = [...files.keys()]
  for (const prefix of ['runtimes/win-x64/lib/', 'runtimes/win/lib/', 'lib/']) {
    for (const folder of FOLDERS) {
      const inFolder = names.filter((name) => name.startsWith(`${prefix}${folder}/`))
      // `_._` means the framework itself provides the assembly.
      if (inFolder.some((name) => name.endsWith('/_._'))) return []
      const dlls = inFolder.filter((name) => name.toLowerCase().endsWith('.dll'))
      if (dlls.length > 0) return dlls
    }
  }
  return []
}

async function main() {
  const force = process.argv.includes('--force')
  if (!force && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === `${ROOT_PACKAGE} ${ROOT_VERSION}`) {
    console.log(`resources/lhm already has ${ROOT_PACKAGE} ${ROOT_VERSION}`)
    return
  }

  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  const seen = new Map()
  const queue = [{ id: ROOT_PACKAGE, version: ROOT_VERSION }]
  const manifest = []
  while (queue.length > 0) {
    const { id, version } = queue.shift()
    if (seen.has(id.toLowerCase())) continue
    seen.set(id.toLowerCase(), version)

    const files = unzip(await download(id, version))
    const nuspecName = [...files.keys()].find((name) => name.endsWith('.nuspec') && !name.includes('/'))
    queue.push(...dependencies(files.get(nuspecName)().toString('utf8')))

    for (const name of libraryFiles(files)) {
      const data = files.get(name)()
      const fileName = name.split('/').pop()
      writeFileSync(join(OUT_DIR, fileName), data)
      manifest.push(`${createHash('sha256').update(data).digest('hex')}  ${fileName}  (${id} ${version})`)
    }
  }

  writeFileSync(join(OUT_DIR, 'SHA256SUMS'), `${manifest.join('\n')}\n`)
  writeFileSync(STAMP, `${ROOT_PACKAGE} ${ROOT_VERSION}\n`)
  console.log(`Fetched ${manifest.length} assemblies into resources/lhm:\n${manifest.join('\n')}`)
}

main().catch((error) => {
  console.error(`fetch-lhm: ${error.message}`)
  process.exit(1)
})
