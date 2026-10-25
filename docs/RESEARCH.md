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
asks ASUS's public support catalogue directly
(`/support/webapi/product/GetPDDrivers` and `GetPDBIOS`) and reads installed
versions from Windows.

## Fan control (next)

Armoury Crate ships `AsusFanControlService` and talks to the board's Nuvoton
Super I/O chip (`NCTSmbus`, `Global\ASUS_SIO_MUTEX`). That needs kernel-level
port access, unlike lighting, so it will be a separate, opt-in step.
