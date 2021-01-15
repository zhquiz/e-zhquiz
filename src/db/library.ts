import { Ulid } from 'id128'
import jieba from 'nodejieba'

import { g } from '../shared'
import { sql, sqlJoin } from './util'

export interface IDbLibrary {
  title: string;
  entries: string[];
  description?: string;
  tag?: string;
  source?: string;
}

export class DbLibrary {
  static tableName = 'library'

  static async init () {
    await g.server.db.exec(sql`
      CREATE TABLE IF NOT EXISTS [library] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        title       TEXT,
        entries     JSON DEFAULT '[]',
        source      TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_library_updatedAt ON [library](updatedAt);
      CREATE INDEX IF NOT EXISTS idx_library_source ON [library](source);

      CREATE TRIGGER IF NOT EXISTS t_library_updatedAt
        AFTER UPDATE ON [library]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [library] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS library_q USING fts5(
        id,
        title,
        [entry],
        [description],
        tag
      );
    `)

    const r = await g.server.db.get(
      sql`
      SELECT * FROM [library] WHERE source = 'zh'
    `
    )

    if (!r) {
      await g.server.zh
        .all(
          sql`
          SELECT title, entries FROM library
          `
        )
        .then((data) => {
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

  static async create (items: IDbLibrary[]) {
    const out: DbLibrary[] = []

    for (const it of items) {
      const id = Ulid.generate().toCanonical()

      await g.server.db.run(sql`
        INSERT INTO [library] (id, title, entries, source)
        VALUES (${id}, ${it.title}, ${JSON.stringify(it.entries)}, ${
        it.source || null
      })
      `)

      await g.server.db.run(sql`
        INSERT INTO library_q (id, title, [entry], [description], tag)
        VALUES (
          ${id},
          ${jieba.cutForSearch(it.title).join(' ')},
          ${it.entries.join(' ')},
          ${it.description || ''},
          ${it.tag || ''}
        )
      `)

      out.push(
        new DbLibrary({
          ...it,
          id
        })
      )
    }

    return out
  }

  static async update (items: (Partial<IDbLibrary> & { id: string })[]) {
    for (const it of items) {
      const entries = it.entries || []

      if (it.title || entries.length || typeof it.source !== 'undefined') {
        await g.server.db.run(sql`
          UPDATE [library]
          SET ${sqlJoin(
            [
              it.title ? sql`title = ${it.title || ''}` : undefined,
              entries.length
                ? sql`entries = ${JSON.stringify(entries)}`
                : undefined,
              typeof it.source !== 'undefined'
                ? sql`source = ${it.source || ''}`
                : undefined
            ]
              .filter((s) => s)
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              .map((s) => s!),
            ','
          )}
          WHERE id = ${it.id}
        `)
      }

      await g.server.db.run(sql`
          UPDATE library_q
          SET ${sqlJoin(
            [
              it.title ? sql`title = ${it.title || ''}` : undefined,
              entries.length ? sql`entry = ${entries.join(' ')}` : undefined,
              it.description !== null
                ? sql`[description] = ${it.description || ''}`
                : undefined,
              it.tag !== null ? sql`tag = ${it.tag || ''}` : undefined
            ]
              .filter((s) => s)
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              .map((s) => s!),
            ','
          )}
          WHERE id = $id
        `)
    }
  }

  static async delete (ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    await g.server.db.run(sql`
      DELETE FROM library_q
      WHERE id IN ${ids}
    `)

    await g.server.db.run(sql`
      DELETE FROM [library]
      WHERE id IN ${ids}
    `)
  }

  private constructor (public entry: Partial<IDbLibrary> & { id: string }) {
    if (!entry.id) {
      throw new Error('no entry id')
    }
  }
}
