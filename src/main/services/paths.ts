import { join } from 'node:path'

/**
 * Owns every absolute path Streamline writes to. All state lives under one
 * root directory so it can be backed up or deleted in one go.
 */
export class Paths {
  constructor(readonly root: string) {}

  get db(): string {
    return join(this.root, 'db.json')
  }

  get logs(): string {
    return join(this.root, 'logs')
  }
}
