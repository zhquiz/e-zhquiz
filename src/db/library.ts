import { Ulid } from 'id128'
import jieba from 'nodejieba'

import { g } from '../shared'

export interface IDbLibrary {
  title: string
  entries: string[]
  description?: string
  tag?: string
  source?: string
}

export class DbLibrary {
  static tableName = 'library'

  static async init() {
    await g.server.db.exec(/* sql */ `
      CREATE TABLE IF NOT EXISTS [${this.tableName}] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        title       TEXT,
        entries     JSON DEFAULT '[]',
        source      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updatedAt ON [${this.tableName}](updatedAt);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_source ON [${this.tableName}](source);

      CREATE TRIGGER IF NOT EXISTS t_${this.tableName}_updatedAt
        AFTER UPDATE ON [${this.tableName}]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [${this.tableName}] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_q USING fts5(
        id,
        title,
        [entry],
        [description],
        tag
      );
    `)

    const r = await g.server.db
      .prepare(
        /* sql */ `
      SELECT * FROM [${this.tableName}] WHERE source = 'zh'
    `
      )
      .then((s) => s.get({}))

    if (!r) {
      await g.server.zh
        .prepare(
          /* sql */ `
          SELECT title, entries FROM library
          `
        )
        .then((s) => s.all({}))
        .then(({ data }) => {
          return g.server.db.transaction(async () => {
            await this.create(
              data.map((r) => ({
                title: r.title as string,
                entries: (r.entries as string)
                  .replace(/^\x1f/, '')
                  .replace(/\x1f$/, '')
                  .split('\x1f'),
                source: 'zh'
              }))
            )
          })
        })
    }
  }

  static async create(items: IDbLibrary[]) {
    const out: DbLibrary[] = []

    const stmt = await g.server.db.prepare<{
      $id: string
      $title: string
      $entries: string
      $source: string | null
    }>(/* sql */ `
      INSERT INTO [${this.tableName}] (id, title, entries, source)
      VALUES ($id, $title, $entries, $source)
    `)

    const stmtQ = await g.server.db.prepare<{
      $id: string
      $jieba_title: string
      $entry: string
      $description: string
      $tag: string
    }>(/* sql */ `
      INSERT INTO ${this.tableName}_q (id, title, [entry], [description], tag)
      VALUES (
        $id,
        $jieba_title,
        $entry,
        $description,
        $tag
      )
    `)

    for (const it of items) {
      const id = Ulid.generate().toCanonical()

      await stmt.run({
        $id: id,
        $title: it.title,
        $entries: JSON.stringify(it.entries),
        $source: it.source || null
      })

      await stmtQ.run({
        $id: id,
        $jieba_title: jieba.cutForSearch(it.title).join(' '),
        $entry: it.entries.join(' '),
        $description: it.description || '',
        $tag: it.tag || ''
      })

      out.push(
        new DbLibrary({
          ...it,
          id
        })
      )
    }

    await stmt.finalize()
    await stmtQ.finalize()

    return out
  }

  static async update(items: (Partial<IDbLibrary> & { id: string })[]) {
    for (const it of items) {
      const entries = it.entries || []

      const stmt = await g.server.db.prepare<{
        $id: string
        $title: string
        $entries: string
        $source: string | null
      }>(/* sql */ `
        UPDATE [${this.tableName}]
        SET ${[
          it.title ? 'title = $title' : '',
          entries.length ? 'entries = $entries' : '',
          typeof it.source !== 'undefined' ? 'source = $source' : ''
        ]
          .filter((s) => s)
          .join(',')}
        WHERE id = $id
      `)

      const stmtQ = await g.server.db.prepare<{
        $title: string
        $entry: string
        $description: string
        $tag: string
        $id: string
      }>(/* sql */ `
        UPDATE ${this.tableName}_q
        SET ${[
          it.title ? 'title = $title' : '',
          entries.length ? '' : 'entry = $entry',
          it.description !== null ? '[description] = $description' : '',
          it.tag !== null ? 'tag = $tag' : ''
        ]
          .filter((s) => s)
          .join(',')}
        WHERE id = $id
      `)

      if (it.title || entries.length || typeof it.source !== 'undefined') {
        stmt.run({
          $id: it.id,
          $title: it.title || '',
          $entries: JSON.stringify(entries),
          $source: it.source || ''
        })
      }

      stmtQ.run({
        $id: it.id,
        $title: it.title || '',
        $entry: entries.join(' '),
        $description: it.description || '',
        $tag: it.tag || ''
      })

      await stmt.finalize()
      await stmtQ.finalize()
    }
  }

  static async delete(ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    const stmt = await g.server.db.prepare(/* sql */ `
      DELETE FROM ${this.tableName}_q
      WHERE id IN (${Array(ids.length).fill('?')})
    `)

    await stmt.run(ids)

    const stmtQ = await g.server.db.prepare(/* sql */ `
      DELETE FROM [${this.tableName}]
      WHERE id IN (${Array(ids.length).fill('?')})
    `)

    await stmtQ.run(ids)

    await stmt.finalize()
    await stmtQ.finalize()
  }

  private constructor(public entry: Partial<IDbLibrary> & { id: string }) {
    if (!entry.id) {
      throw new Error('no entry id')
    }
  }
}
