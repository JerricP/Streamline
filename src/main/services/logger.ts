import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Minimal append-only logger. Everything lands in <dataDir>/logs/streamline.log so
 * users can attach it to a bug report. Writes are best effort: logging must
 * never be able to crash the app.
 */
export class Logger {
  private ready: Promise<void> | null = null

  constructor(private readonly logDir: string) {}

  private file(): string {
    const day = new Date().toISOString().slice(0, 10)
    return join(this.logDir, `streamline-${day}.log`)
  }

  private async ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = mkdir(this.logDir, { recursive: true }).then(() => undefined)
    }
    return this.ready
  }

  private async write(level: LogLevel, scope: string, message: string): Promise<void> {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${scope}: ${message}\n`
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    sink(line.trimEnd())
    try {
      await this.ensure()
      await appendFile(this.file(), line, 'utf8')
    } catch {
      // Logging failures are intentionally swallowed.
    }
  }

  info(scope: string, message: string): void {
    void this.write('info', scope, message)
  }

  warn(scope: string, message: string): void {
    void this.write('warn', scope, message)
  }

  error(scope: string, message: string): void {
    void this.write('error', scope, message)
  }
}
