import { g } from '../shared'
import { sql } from './util'

export class DbSentence {
  static async init() {
    await g.server.db.exec(sql`
      CREATE TABLE IF NOT EXISTS sentence (
        chinese   TEXT NOT NULL UNIQUE,
        english   TEXT
      )
    `)
  }
}
