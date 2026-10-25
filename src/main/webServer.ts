import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { Handler } from './handlers'
import type { Logger } from './services/logger'

/**
 * Serves the settings UI to the user's browser while Streamline sits in the tray.
 *
 * ASUS DriverHub was hit by remote-code-execution bugs because its local agent
 * accepted commands from any web page. This server is built to avoid that:
 * - it binds to 127.0.0.1 only, never the network;
 * - every API call needs a random per-launch token that only the tray hands
 *   out (any site can send requests to localhost, but none can know it);
 * - the Host header must be our own address, which defeats DNS rebinding;
 * - cross-origin requests are refused, and no CORS headers are ever sent.
 */

/** Preferred port, so the address stays the same between launches. */
const PREFERRED_PORT = 47822
const MAX_BODY_BYTES = 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

export interface WebServer {
  /** The address to open, including the token fragment. */
  url: string
  close(): Promise<void>
}

function send(response: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer'
  })
  response.end(body)
}

function tokensMatch(expected: Buffer, provided: string | string[] | undefined): boolean {
  if (typeof provided !== 'string') return false
  const candidate = Buffer.from(provided)
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolvePort((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

export async function startWebServer(
  staticRoot: string,
  handlers: Map<string, Handler>,
  logger: Logger
): Promise<WebServer> {
  const token = randomBytes(24).toString('base64url')
  const expectedToken = Buffer.from(token)
  const root = resolve(staticRoot)
  let allowedHosts = new Set<string>()

  const serveStatic = (pathname: string, response: ServerResponse) => {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
    const target = normalize(join(root, relative))
    if (target !== root && !target.startsWith(root + sep)) return send(response, 404, 'Not found')
    const file = existsSync(target) && statSync(target).isFile() ? target : join(root, 'index.html')
    if (!existsSync(file)) return send(response, 503, 'The Streamline UI has not been built.')
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    })
    createReadStream(file).pipe(response)
  }

  const invoke = async (request: IncomingMessage, response: ServerResponse) => {
    if (!tokensMatch(expectedToken, request.headers['x-streamline-token'])) return send(response, 401, 'Unauthorized')
    if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
      return send(response, 415, 'Expected JSON')
    }

    let payload: { channel?: unknown; args?: unknown }
    try {
      payload = JSON.parse(await readBody(request)) as typeof payload
    } catch {
      return send(response, 400, 'Malformed request')
    }

    const handler = typeof payload.channel === 'string' ? handlers.get(payload.channel) : undefined
    if (!handler) return send(response, 404, 'Unknown channel')
    const args = Array.isArray(payload.args) ? payload.args : []
    send(response, 200, JSON.stringify(await handler(...args)), 'application/json; charset=utf-8')
  }

  const server = createServer((request, response) => {
    // DNS rebinding: a hostile domain resolving to 127.0.0.1 still sends its own Host.
    if (!allowedHosts.has((request.headers.host ?? '').toLowerCase())) return send(response, 421, 'Misdirected request')
    const origin = request.headers.origin
    if (origin && !allowedHosts.has(origin.replace(/^http:\/\//, '').toLowerCase())) {
      return send(response, 403, 'Cross-origin requests are not allowed')
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/api/invoke') {
      if (request.method !== 'POST') return send(response, 405, 'Method not allowed')
      invoke(request, response).catch((error) => {
        logger.error('web', `Request failed: ${String(error)}`)
        if (!response.headersSent) send(response, 500, 'Internal error')
      })
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, 'Method not allowed')
    serveStatic(pathname, response)
  })

  let port: number
  try {
    port = await listen(server, PREFERRED_PORT)
  } catch {
    port = await listen(server, 0)
  }
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  logger.info('web', `Settings UI on http://127.0.0.1:${port}`)

  return {
    url: `http://127.0.0.1:${port}/#token=${token}`,
    close: () => new Promise((done) => server.close(() => done()))
  }
}
