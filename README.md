# Streamline

One small Windows tray app that replaces the parts of three vendor apps that
are actually used on this PC:

| Replaces | Kept | Status |
| --- | --- | --- |
| Armoury Crate | Aura motherboard lighting | ✅ first version |
| ASUS DriverHub | Checking for BIOS and driver updates | ✅ first version |
| Armoury Crate | Fan curves and a sensor overview | ✅ first version |
| Creative App | Creative Pebble Pro speaker controls | ⏳ later |

Streamline lives in the notification area. There is no main window: clicking
the tray icon opens the settings page in your browser, served from
`127.0.0.1`. The tray menu also has quick lighting modes and a driver check.

Target hardware: ASUS ROG Strix B850-I (Aura USB controller), Windows 10/11.

## How it works

- **Lighting** talks to the ASUS Aura USB HID controller directly (vendor
  `0x0B05`, usage page `0xFF72`). The effect is stored on the controller, so it
  survives without Streamline running; Streamline re-applies it on start-up too.
- **Driver updates** read installed versions from Windows (SMBIOS, signed
  drivers, installed programs) and compare them with ASUS's public support
  catalogue for the board. Downloads open in the browser; nothing is installed
  automatically.
- **Sensors and fans** come from the motherboard's Nuvoton Super I/O chip
  (and the CPU, GPU, memory and drives) through
  [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor),
  loaded by a small PowerShell helper that runs as administrator. It needs the
  signed [PawnIO](https://pawnio.eu/) driver (`winget install namazso.PawnIO`).
  Monitoring is off until you turn it on from the Overview page; Windows then
  asks for administrator rights. Each fan header can stay on the BIOS curve,
  run at a fixed speed, or follow a curve you drag into shape against any
  temperature. If Streamline quits or crashes, the helper hands every fan back
  to the BIOS.
- **Settings page** is a React app served by a local web server that only
  listens on loopback and needs a random per-launch token. See
  [docs/SECURITY.md](docs/SECURITY.md).

[docs/RESEARCH.md](docs/RESEARCH.md) records what was learned from the
installed Armoury Crate and DriverHub, and why Streamline doesn't reuse their
services.

## Switching over from Armoury Crate

Armoury Crate's `LightingService` writes to the same controller and will undo
your changes. Streamline shows a warning while it runs. Once you're happy,
stop and disable that service (or uninstall Armoury Crate). The same goes for
`AsusFanControlService` once you use Streamline's fan curves; Streamline warns
while it runs. Fans left on "BIOS" keep following the board's Q-Fan settings.

## Requirements

- Windows 10/11 on an ASUS board with an Aura USB controller
- Node.js 22+ and npm to build

Set `STREAMLINE_SIMULATE_SENSORS=1` to develop the Overview and Fans pages
with made-up readings on a machine without the hardware.

If `npm start` says Electron failed to install, run
`node node_modules/electron/install.js` once to download it.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run with Vite HMR for the settings page |
| `npm run fetch:lhm` | Download LibreHardwareMonitorLib into `resources/lhm` (build, dev and start do this too) |
| `npm run build` | Production bundle into `out/` |
| `npm start` | Run the production bundle |
| `npm test` | Unit tests (protocol packets, driver matching, fan curves, web server) |
| `npm run typecheck` | Type-check main and web projects |
| `npm run dist` | Build and package a Windows installer |

## Project layout

```
src/
  main/            Electron main process: tray, local web server, API handlers
    services/      Aura controller, driver check, sensors and fan curves, logging, paths
resources/
  sensors/         PowerShell sensor helper (runs elevated, talks over a named pipe)
  lhm/             LibreHardwareMonitorLib, downloaded at build time (not committed)
  renderer/        React settings page (served to the browser)
  shared/          types, request names and the API client shared by both
test/              node:test unit tests
docs/              research notes and security notes
```

## License

MIT — see [LICENSE](LICENSE).
