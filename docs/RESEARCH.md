# Research notes

What was learned from the vendor software installed on the target PC
(2026-10-25), and how it shaped Streamline. Analysis only: no vendor code or
assets are used.

## Armoury Crate lighting

| Item | Observation |
| --- | --- |
| Install | `C:\Program Files\ASUS\AacMB\Aac3572MbHal_x64.exe` (motherboard HAL), `C:\Program Files\ASUS\AuraSDK\AuraSdk_x64.dll` |
| Transport | Plain USB HID (`HID.DLL`: `HidD_GetAttributes`, `HidP_GetCaps`), plus WinUSB for some controllers |
| Controllers named | ST072, ST9615, STL452, 6K75 ("Aura50" protocol, Gen1/Gen2 ARGB) |
| Locking | Named mutexes `Global\asusaurausb`, `Aura50_USB_HID_MUTEX_`, `ST9615_MUTEX_` |
| Board key | `SOFTWARE\ASUS\ARMOURY CRATE Devices\MOTHERBOARD\0B05_22B8` |

Conclusion: the board's lighting is a USB HID device, not SMBus, so it can be
driven from user mode with no driver. Streamline uses the community-documented
Aura USB report format (65-byte reports, id `0xEC`; `0x82` firmware, `0xB0`
config table, `0x35` effect, `0x36` colour, `0x3F` commit).

Armoury Crate's `LightingService` keeps rewriting the controller, so the two
can't run side by side. Streamline warns when that service is running rather
than stopping it for you.

**Still to verify on the real board:** the ARGB header channel layout (the
"Include ARGB headers" switch is marked experimental until then). The Lighting
page shows the controller's firmware string and raw config table to help.

## ASUS DriverHub

| Item | Observation |
| --- | --- |
| Install | `C:\Program Files\ASUS\AsusDriverHub\` |
| `ASUS DriverHub.exe` | .NET shell that opens `https://driverhub.asus.com` |
| `ADU.exe` | Native local agent: websocketpp server on `127.0.0.1`, nlohmann JSON, `assistant.asus.com` endpoints, LiveUpdate URLs |

DriverHub is a web page that drives a privileged local agent over a localhost
websocket. That design is what made it vulnerable to remote code execution in
2025 (any site could talk to the agent). Streamline doesn't use the agent; it
asks ASUS's public support catalogue directly and reads installed versions
from Windows. Checked live on the target PC (2026-10-25):

| Endpoint | Result |
| --- | --- |
| `rog.asus.com/support/webapi/product/GetPDDrivers?website=global&model=<MODEL-DASHED>&pdid=&cpu=&osid=52` | 200; groups LAN, Wireless, Chipset, Audio, VGA Drivers, USB, Bluetooth, Software and Utility, SATA, Utilities |
| `rog.asus.com/support/webapi/product/GetPDBIOS?website=global&model=<MODEL-DASHED>&pdid=&cpu=` | 200; one `BIOS` group. **404 without `&cpu=`** |
| `www.asus.com/support/webapi/...` | 404 |

BIOS files have an empty `Title` (the text is in `Description`) and
`IsRelease: 0` marks betas, which Streamline skips.

The board on the target PC reports itself as **ROG STRIX B850-I GAMING
WIFI** (Aura controller PID `0x19AF`).

## Creative Pebble Pro (next)

| Item | Observation |
| --- | --- |
| USB | VID `0x041E`, PID `0x3287`, release `0x1010` |
| HID (MI_00) | Col01 usage page `0x01` with no usage (likely the vendor/lighting channel), Col02 consumer control, Col03 telephony |
| Audio | MI_01, "Creative Pebble Pro" |
| Creative App | `Creative.Platform.Devices.dll` (.NET), `HidLibrary.dll`, `AirohaHidCoreLib.dll` (Airoha chip) |

## Fan control and sensors

Armoury Crate ships `AsusFanControlService` and talks to the board's Nuvoton
Super I/O chip (`NCTSmbus`, `Global\ASUS_SIO_MUTEX`). That chip sits behind
I/O ports, so unlike lighting it needs a kernel driver.

| Option | Verdict |
| --- | --- |
| Reuse Armoury Crate's driver (AsIO3) | No: undocumented, and its past CVEs are why people avoid it |
| WinRing0 (old LibreHardwareMonitor, FanControl) | No: flagged as a vulnerable driver by Defender since 2025 |
| LibreHardwareMonitorLib 0.9.6 + PawnIO | **Used.** PawnIO is a signed driver that only runs small verified modules; LHM ships the Super I/O module |

LibreHardwareMonitorLib 0.9.6 lists the **ROG STRIX B850-I GAMING WIFI** and
the **NCT6701D** chip by name, so it labels this board's fan headers and
temperatures. It needs:

- **PawnIO** installed once (`winget install namazso.PawnIO`, or pawnio.eu);
  without it CPU/GPU/drive sensors still show, but no motherboard fans.
- **Administrator rights**, because PawnIO only opens for admins.

Streamline stays a normal user-mode app. When monitoring is turned on it
starts `resources/sensors/StreamlineSensors.ps1` elevated (UAC prompt) under
Windows PowerShell 5.1, which is .NET Framework and can load LHM's net472
build directly, so no .NET SDK is needed. The helper connects back to the app
over a random named pipe, proves itself with a per-launch token, and only
understands `read`, `set` (duty 0-100 on a known control) and `default`.
Closing the pipe for any reason makes it call `SetDefault()` on every fan it
touched, so a crash leaves fans on the BIOS curve, not stuck.

Fan curve safety (`src/main/services/fanCurves.ts`): a curve whose
temperature can't be read, or reads 95 °C or more, runs at 100%; changes ramp
(+8%/s, -3%/s) so short CPU spikes don't rev fans; anything that takes a fan
back from Streamline (e.g. Armoury Crate) is overridden on the next tick.

Only motherboard headers and coolers are offered on the Fans page. LHM can
also drive graphics card fans through the GPU driver, but that would override
the card's zero-RPM idle mode, and Armoury Crate never did it.

Checked on the target PC (2026-10-25), helper run **without** admin or PawnIO:
it loads cleanly under PowerShell 5.1.26100, a full read takes ~100-170 ms,
and closing the pipe ends it. It saw the Ryzen 7 9800X3D (Tctl/Tdie reading 0
without driver access), the RTX 5080 and the Radeon iGPU, but no Super I/O
chip and no drives, as expected without PawnIO and admin. PawnIO was not
installed and `AsusFanControlService` was running.

With PawnIO and admin it found the **Nuvoton NCT6701D** (`/lpc/nct6701d/0`):
CPU Fan (control/1, an AIO pump at ~2,900 RPM), Chassis Fan (control/0, the
AIO radiator fans, ~1,130 RPM at 71% on BIOS), Extra Flow Fan (control/5) and
AIO Pump (control/6), plus Tctl/Tdie and the NVMe drives.

**Fan control does not work on this chip with LHM 0.9.6.** Setting the
Chassis Fan to 51%, and then to a fixed 100%, dropped it to 0 RPM while the
chip read back the duty that was written. LHM has no NCT6701D-specific code:
it takes manual control the way it does for older Nuvoton chips (mode
register 0x102 ← 0, duty to 0x109). Until that is understood, Streamline
lists NCT6701D fans read-only and keeps them on the BIOS (`canControl` in
`fanCurves.ts`). Next lead: drive the chip's own SmartFan curve registers,
which is what Armoury Crate's `AsusFanControlService` appears to do, instead
of manual duty.

Also added after this test: a stall guard (a fan that has spun before and
reads 0 RPM for 6 s at ≥25% goes back to the BIOS), a per-fan minimum speed,
and fan names.
