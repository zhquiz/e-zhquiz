import S from 'jsonschema-definer'

import { g } from '../shared'
import { sql } from './util'

export const sDbUserMeta = S.shape({
  forvo: S.string(),
  level: S.integer().minimum(1).maximum(60),
  levelMin: S.integer().minimum(1).maximum(60),
  settings: S.shape({
    level: S.shape({
      whatToShow: S.list(S.string())
    }),
    quiz: S.shape({
      type: S.list(S.string()),
      stage: S.list(S.string()),
      direction: S.list(S.string()),
      isDue: S.boolean()
    }),
    sentence: S.shape({
      min: S.integer().minimum(2),
      max: S.integer().minimum(2)
    })
  })
})

export type IDbUserMeta = typeof sDbUserMeta.type

export class DbUser {
  static async init () {
    await g.server.db.exec(sql`
      CREATE TABLE IF NOT EXISTS [user] (
        id          INT PRIMARY KEY DEFAULT 1,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        meta        JSON DEFAULT '{}'
      );

      CREATE TRIGGER IF NOT EXISTS t_user_updatedAt
        AFTER UPDATE ON [user]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [user] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;
      
      INSERT OR IGNORE INTO user (id) VALUES (1);
    `)
  }
}
