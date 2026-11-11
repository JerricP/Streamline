# Security notes

Streamline's settings page is a website served from the same PC, which is the
pattern that got ASUS DriverHub into trouble. The local server is built so a
web page you visit can't use it:

- **Loopback only.** It listens on `127.0.0.1`, never on the network.
- **Per-launch token.** Every API call needs a 192-bit random token that only
  the tray hands out, in the URL fragment (`#token=…`), which browsers never
  send to servers. The page moves it to `sessionStorage` and clears it from
  the address bar.
- **Host check.** Requests must carry `Host: 127.0.0.1:<port>` or
  `localhost:<port>`, which defeats DNS rebinding.
- **No cross-origin access.** Requests with a foreign `Origin` are refused and
  no CORS headers are sent, so other sites can't read responses.
- **Narrow API.** Inputs are rebuilt from known fields; links can only open
  `https:` URLs; nothing downloads or runs installers.

Restarting Streamline invalidates the token; open the page again from the tray.

## Sensor helper

Fan control needs administrator rights, so only the small sensor helper runs
elevated, never the tray app or its web server.

- It is started only after you turn monitoring on, through a normal UAC prompt.
- It connects out to a named pipe with a random name created by the tray app,
  and must present a random per-launch token before the app talks to it.
- It accepts three commands: read sensors, set a known fan control to 0-100%,
  and hand a fan back to the BIOS. There is no command that runs code or
  touches files.
- The web UI never talks to it; fan settings are validated in the main process
  (`sanitizeFanConfig`) before the fan engine uses them.
- LibreHardwareMonitorLib and its dependencies are downloaded from nuget.org
  at pinned versions; `resources/lhm/SHA256SUMS` records what was bundled.
