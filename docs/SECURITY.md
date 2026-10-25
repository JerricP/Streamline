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
