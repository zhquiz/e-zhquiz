import { Ulid } from 'id128'

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

  static init() {
    g.server.db.exec(/* sql */ `
      CREATE TABLE IF NOT EXISTS [${this.tableName}] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP strftime('%s','now'),
        updatedAt   TIMESTAMP strftime('%s','now'),
        title       TEXT,
        entries     JSON DEFAULT '[]',
        source      TEXT
      );

      CREATE TRIGGER IF NOT EXISTS t_${this.tableName}_updatedAt
        AFTER UPDATE ON [${this.tableName}]
        WHEN NEW.updatedAt IS NULL
        FOR EACH ROW BEGIN
          UPDATE [${this.tableName}] SET updatedAt = strftime('%s','now') WHERE id = NEW.id
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_q USING fts5(
        id,
        title,
        [entry],
        [description],
        tag
      );
    `)

    const r = g.server.db
      .prepare(
        /* sql */ `
      SELECT COUNT(*) FROM [${this.tableName}] WHERE source = 'zh'
    `
      )
      .get()

    if (!r) {
      this.create(
        ...g.server.zh
          .prepare(
            /* sql */ `
        SELECT title, entries FROM library
      `
          )
          .all()
          .map((r) => ({
            title: r.title as string,
            entries: (r.entries as string)
              .replace(/^\x1f/, '')
              .replace(/\x1f$/, '')
              .split(/\x1f/g),
            source: 'zh'
          }))
      )
    }
  }

  static create(...items: IDbLibrary[]) {
    const out: DbLibrary[] = []

    g.server.db.transaction(() => {
      const stmt = g.server.db.prepare<{
        id: string
        title: string
        entries: string
        source: string | null
      }>(/* sql */ `
        INSERT INTO [${this.tableName}] (id, title, entries, source)
        VALUES (@id, @title, @entries, @source)
      `)

      const stmtQ = g.server.db.prepare<{
        id: string
        title: string
        entry: string
        description: string
        tag: string
      }>(/* sql */ `
        INSERT INTO ${this.tableName}_q (id, title, [entry], [description], tag)
        VALUES (
          @id,
          jieba(@title),
          @entry,
          @description,
          @tag
        )
      `)

      items.map((it) => {
        const id = Ulid.generate().toCanonical()

        stmt.run({
          id,
          title: it.title,
          entries: JSON.stringify(it.entries),
          source: it.source || null
        })

        stmtQ.run({
          id,
          title: it.title,
          entry: it.entries.join(' '),
          description: it.description || '',
          tag: it.tag || ''
        })

        out.push(
          new DbLibrary({
            ...it,
            id
          })
        )
      })
    })()

    return out
  }

  static update(...items: (Partial<IDbLibrary> & { id: string })[]) {
    g.server.db.transaction(() => {
      items.map((it) => {
        const entries = it.entries || []

        const stmt = g.server.db.prepare<{
          id: string
          title: string
          entries: string
          source: string
        }>(/* sql */ `
          UPDATE [${this.tableName}]
          SET ${[
            it.title ? 'title = @title' : '',
            entries.length ? 'entries = @entries' : '',
            typeof it.source !== 'undefined' ? 'source = @source' : ''
          ]
            .filter((s) => s)
            .join(',')}
          WHERE id = @id
        `)

        const stmtQ = g.server.db.prepare<{
          id: string
          title: string
          entry: string
          description: string | null
          tag: string | null
        }>(/* sql */ `
          UPDATE ${this.tableName}_q
          SET ${[
            it.title ? 'title = @title' : '',
            entries.length ? '' : 'entry = @entry',
            it.description !== null ? '[description] = @description' : '',
            it.tag !== null ? 'tag = @tag' : ''
          ]
            .filter((s) => s)
            .join(',')}
          WHERE id = @id
        `)

        if (it.title || entries.length || typeof it.source !== 'undefined') {
          stmt.run({
            id: it.id,
            title: it.title || '',
            entries: JSON.stringify(entries),
            source: it.source || ''
          })
        }

        stmtQ.run({
          id: it.id,
          title: it.title || '',
          entry: entries.join(' '),
          description: it.description ?? null,
          tag: it.tag ?? null
        })
      })
    })()
  }

  static delete(...ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    g.server.db
      .prepare(
        /* sql */ `
    DELETE FROM ${this.tableName}_q
    WHERE id IN (${Array(ids.length).fill('?')})
    `
      )
      .run(...ids)

    g.server.db
      .prepare(
        /* sql */ `
    DELETE FROM [${this.tableName}]
    WHERE id IN (${Array(ids.length).fill('?')})
    `
      )
      .run(...ids)
  }

  private constructor(public entry: Partial<IDbLibrary> & { id: string }) {
    if (!entry.id) {
      throw new Error('no entry id')
    }
  }
}
