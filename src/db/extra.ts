import toPinyin from 'chinese-to-pinyin'
import { Ulid } from 'id128'
import jieba from 'nodejieba'

import { g } from '../shared'
import { sql, sqlJoin } from './util'

export interface IDbExtra {
  chinese: string
  pinyin?: string
  english?: string
  type?: string
  description?: string
  tag?: string
}

export class DbExtra {
  static async init() {
    await g.server.db.exec(sql`
      CREATE TABLE IF NOT EXISTS [extra] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        chinese     TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_extra_updatedAt ON [extra](updatedAt);

      CREATE TRIGGER IF NOT EXISTS t_extra_updatedAt
        AFTER UPDATE ON [extra]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [extra] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS extra_q USING fts5(
        id,
        chinese,
        pinyin,
        english,
        [type],
        [description],
        tag
      );
    `)
  }

  static async create(items: IDbExtra[]) {
    const out: DbExtra[] = []

    for (const it of items) {
      const id = Ulid.generate().toCanonical()
      const pinyin =
        it.pinyin ||
        toPinyin(it.chinese, { toneToNumber: true, keepRest: true })

      await g.server.db.run(sql`
        INSERT INTO [extra] (id, chinese)
        VALUES (${id}, ${it.chinese})
      `)

      await g.server.db.run(sql`
        INSERT INTO extra_q (id, chinese, pinyin, english, [type], [description], tag)
        VALUES (
          ${id},
          ${jieba.cutForSearch(it.chinese).join(' ')},
          ${pinyin},
          ${it.english || ''},
          ${it.type || 'vocab'},
          ${it.description || ''},
          ${it.tag || ''}
        )
      `)

      out.push(
        new DbExtra({
          ...it,
          id,
          pinyin
        })
      )
    }

    return out
  }

  static async update(items: (Partial<IDbExtra> & { id: string })[]) {
    for (const it of items) {
      if (it.chinese) {
        await g.server.db.run(sql`
          UPDATE [extra]
          SET chinese = ${it.chinese}
          WHERE id = ${it.id}
        `)
      }

      await g.server.db.run(sql`
        UPDATE extra_q
        SET ${sqlJoin(
          [
            it.chinese
              ? sql`
                chinese = ${jieba.cutForSearch(it.chinese || '').join(' ')},
                pinyin = ${
                  it.pinyin ||
                  toPinyin(it.chinese || '', {
                    keepRest: true,
                    toneToNumber: true
                  })
                }
              `
              : undefined,
            it.english !== null
              ? sql`english = ${it.english || null}`
              : undefined,
            it.type !== null ? sql`[type] = ${it.type ?? null}` : undefined,
            it.description !== null
              ? sql`[description] = ${it.description ?? null}`
              : undefined,
            it.tag !== null ? sql`tag = ${it.tag ?? null}` : undefined
          ]
            .filter((s) => s)
            .map((s) => s!),
          ','
        )}
        WHERE id = ${it.id}
      `)
    }
  }

  static async delete(ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    await g.server.db.run(sql`
      DELETE FROM extra_q
      WHERE id IN ${ids}
    `)
    await g.server.db.run(sql`
      DELETE FROM [extra]
      WHERE id IN ${ids}
    `)
  }

  private constructor(public entry: Partial<IDbExtra> & { id: string }) {
    if (!entry.id) {
      throw new Error('No entry id')
    }
  }
}
