import toPinyin from 'chinese-to-pinyin'
import { Ulid } from 'id128'
import jieba from 'nodejieba'

import { g } from '../shared'

export interface IDbExtra {
  chinese: string
  pinyin?: string
  english?: string
  type?: string
  description?: string
  tag?: string
}

export class DbExtra {
  static tableName = 'extra'

  static async init() {
    await g.server.db.exec(/* sql */ `
      CREATE TABLE IF NOT EXISTS [${this.tableName}] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        chinese     TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updatedAt ON [${this.tableName}](updatedAt);

      CREATE TRIGGER IF NOT EXISTS t_${this.tableName}_updatedAt
        AFTER UPDATE ON [${this.tableName}]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [${this.tableName}] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_q USING fts5(
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

    const stmt = await g.server.db.prepare<{
      $id: string
      $chinese: string
    }>(/* sql */ `
      INSERT INTO [${this.tableName}] (id, chinese)
      VALUES ($id, $chinese)
    `)

    const stmtQ = await g.server.db.prepare<{
      $id: string
      $jieba_chinese: string
      $pinyin: string
      $english: string
      $type: string
      $description: string
      $tag: string
    }>(/* sql */ `
      INSERT INTO ${this.tableName}_q (id, chinese, pinyin, english, [type], [description], tag)
      VALUES (
        $id,
        $jieba_chinese,
        $pinyin,
        $english,
        $type,
        $description,
        $tag
      )
    `)

    for (const it of items) {
      const id = Ulid.generate().toCanonical()
      const pinyin =
        it.pinyin ||
        toPinyin(it.chinese, { toneToNumber: true, keepRest: true })

      await stmt.run({
        $id: id,
        $chinese: it.chinese
      })

      await stmtQ.run({
        $id: id,
        $jieba_chinese: jieba.cutForSearch(it.chinese).join(' '),
        $pinyin: pinyin,
        $english: it.english || '',
        $type: it.type || 'vocab',
        $description: it.description || '',
        $tag: it.tag || ''
      })

      out.push(
        new DbExtra({
          ...it,
          id,
          pinyin
        })
      )
    }

    await stmt.finalize()
    await stmtQ.finalize()

    return out
  }

  static async update(items: (Partial<IDbExtra> & { id: string })[]) {
    const stmt = await g.server.db.prepare<{
      $id: string
      $chinese: string
    }>(/* sql */ `
      UPDATE [${this.tableName}]
      SET chinese = $chinese
      WHERE id = $id
    `)

    for (const it of items) {
      const stmtQ = await g.server.db.prepare<{
        $id: string
        $jieba_chinese: string | null
        $make_pinyin: string | null
        $english: string | null
        $type: string | null
        $description: string | null
        $tag: string | null
      }>(/* sql */ `
        UPDATE ${this.tableName}_q
        SET ${[
          it.chinese
            ? /* sql */ `
          chinese = $jieba_chinese,
          pinyin = $make_pinyin
          `
            : '',
          it.english !== null ? 'english = $english' : '',
          it.type !== null ? '[type] = $type' : '',
          it.description !== null ? '[description] = $description' : '',
          it.tag !== null ? 'tag = $tag' : ''
        ]
          .filter((s) => s)
          .join(',')}
        WHERE id = $id
      `)

      if (it.chinese) {
        await stmt.run({
          $id: it.id,
          $chinese: it.chinese
        })
      }

      await stmtQ.run({
        $id: it.id,
        $jieba_chinese: jieba.cutForSearch(it.chinese || '').join(' '),
        $make_pinyin:
          it.pinyin ||
          toPinyin(it.chinese || '', { keepRest: true, toneToNumber: true }),
        $english: it.english || null,
        $type: it.type ?? null,
        $description: it.description ?? null,
        $tag: it.tag ?? null
      })

      await stmtQ.finalize()
    }

    await stmt.finalize()
  }

  static async delete(ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    const stmt = await g.server.db.prepare(/* sql */ `
      DELETE FROM ${this.tableName}_q
      WHERE id IN (${Array(ids.length).fill('?')})
    `)
    const stmtQ = await g.server.db.prepare(/* sql */ `
      DELETE FROM [${this.tableName}]
      WHERE id IN (${Array(ids.length).fill('?')})
    `)

    await stmt.run(ids)
    await stmtQ.run(ids)

    await stmt.finalize()
    await stmtQ.finalize()
  }

  private constructor(public entry: Partial<IDbExtra> & { id: string }) {
    if (!entry.id) {
      throw new Error('No entry id')
    }
  }
}
