import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { Handler } from '../src/main/handlers.ts'
import type { Logger } from '../src/main/services/logger.ts'
import { startWebServer } from '../src/main/webServer.ts'
import type { WebServer } from '../src/main/webServer.ts'

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as Logger

let server: WebServer
let port: number
let token: string

before(async () => {
  const root = mkdtempSync(join(tmpdir(), 'streamline-ui-'))
  writeFileSync(join(root, 'index.html'), '<html>ui</html>')
  const handlers = new Map<string, Handler>([['echo', async (...args) => ({ ok: true, value: args })]])
  server = await startWebServer(root, handlers, logger)
  const url = new URL(server.url)
  port = Number(url.port)
  token = url.hash.replace('#token=', '')
})

after(() => server.close())

function call(options: { path: string; method?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: options.path, method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end(options.body)
  })
}

const invoke = (headers: Record<string, string>) =>
  call({
    path: '/api/invoke',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ channel: 'echo', args: [1, 'two'] })
  })

test('binds to loopback and serves the UI', async () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/#token=/)
  const page = await call({ path: '/' })
  assert.equal(page.status, 200)
  assert.equal(page.body, '<html>ui</html>')
})

test('refuses path traversal', async () => {
  const response = await call({ path: '/..%2f..%2fetc%2fpasswd' })
  assert.notEqual(response.body.includes('root:'), true)
})

test('API calls need the token', async () => {
  assert.equal((await invoke({})).status, 401)
  assert.equal((await invoke({ 'X-Streamline-Token': 'wrong' })).status, 401)
  const ok = await invoke({ 'X-Streamline-Token': token })
  assert.equal(ok.status, 200)
  assert.deepEqual(JSON.parse(ok.body), { ok: true, value: [1, 'two'] })
})

test('refuses other hosts and cross-origin pages', async () => {
  assert.equal((await invoke({ 'X-Streamline-Token': token, Host: 'evil.example' })).status, 421)
  assert.equal((await invoke({ 'X-Streamline-Token': token, Origin: 'https://evil.example' })).status, 403)
})

test('unknown channels are rejected', async () => {
  const response = await call({
    path: '/api/invoke',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Streamline-Token': token },
    body: JSON.stringify({ channel: 'nope', args: [] })
  })
  assert.equal(response.status, 404)
})
