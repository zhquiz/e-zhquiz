import { Ulid } from 'id128'
import { DurationUnit, addDate } from 'native-duration'
import jieba from 'nodejieba'

import { g } from '../shared'

export const srsMap: [number, DurationUnit][] = [
  [4, 'h'],
  [8, 'h'],
  [1, 'd'],
  [3, 'd'],
  [1, 'w'],
  [2, 'w'],
  [4, 'w'],
  [16, 'w']
]

export interface IDbQuiz {
  entry: string
  pinyin?: string
  english?: string
  type: string
  direction: string
  source?: string
  description?: string
  tag?: string
  srsLevel?: number
  nextReview?: Date
  lastRight?: Date
  lastWrong?: Date
  rightStreak?: number
  wrongStreak?: number
  maxRight?: number
  maxWrong?: number
}

export class DbQuiz {
  static tableName = 'quiz'

  static init() {
    g.server.db.exec(/* sql */ `
      CREATE TABLE IF NOT EXISTS [${this.tableName}] (
        id          TEXT PRIMARY KEY,
        createdAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        updatedAt   TIMESTAMP DEFAULT (strftime('%s','now')),
        [entry]     TEXT NOT NULL,
        [type]      TEXT NOT NULL,
        direction   TEXT NOT NULL,
        source      TEXT,           -- isExtra or not
        srsLevel    INT,
        nextReview  TIMESTAMP,
        lastRight   TIMESTAMP,
        lastWrong   TIMESTAMP,
        rightStreak INT,
        wrongStreak INT,
        maxRight    INT,
        maxWrong    INT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_${this.tableName}_entry_type_direction ON [${this.tableName}]([entry], [type], direction);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_source ON [${this.tableName}](source);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_srsLevel ON [${this.tableName}](srsLevel);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_nextReview ON [${this.tableName}](nextReview);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_lastRight ON [${this.tableName}](lastRight);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_lastWrong ON [${this.tableName}](lastWrong);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_rightStreak ON [${this.tableName}](rightStreak);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_wrongStreak ON [${this.tableName}](wrongStreak);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_maxRight ON [${this.tableName}](maxRight);
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_maxWrong ON [${this.tableName}](maxWrong);

      CREATE TRIGGER IF NOT EXISTS t_${this.tableName}_updatedAt
        AFTER UPDATE ON [${this.tableName}]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [${this.tableName}] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_q USING fts5(
        id,
        [entry],
        pinyin,
        english,
        [type],
        [direction],
        [description],
        tag
      );
    `)
  }

  static create(...items: IDbQuiz[]) {
    const out: DbQuiz[] = []

    const stmt = g.server.db.prepare<{
      id: string
      entry: string
      type: string
      direction: string
      source: string | null
    }>(/* sql */ `
      INSERT INTO [${this.tableName}] (id, [entry], [type], direction, source)
      VALUES (@id, @entry, @type, @direction, @source)
    `)

    const stmtQ = g.server.db.prepare<{
      id: string
      entry: string
      pinyin: string | null
      english: string
      type: string
      direction: string
      description: string
      tag: string
    }>(/* sql */ `
      INSERT INTO ${this.tableName}_q (id, [entry], pinyin, english, [type], direction, [description], tag)
      VALUES (
        @id,
        @entry,
        COALESCE(@pinyin,  to_pinyin(@entry)),
        @english,
        @type,
        @direction,
        @description,
        @tag
      )
    `)

    const stmtEng = g.server.zh.prepare(/* sql */ `
    SELECT english
    FROM vocab
    WHERE simplified = @entry OR traditional = @entry
    `)

    items.map((it) => {
      const id = Ulid.generate().toCanonical()

      stmt.run({
        id,
        entry: it.entry,
        type: it.type,
        direction: it.direction,
        source: it.source || null
      })

      stmtQ.run({
        id,
        entry: it.entry,
        pinyin: it.pinyin
          ? it.pinyin
              .split(' ')
              .map((s) => s.replace(/\d$/, ''))
              .join(' ')
          : null,
        english:
          it.english ||
          jieba
            .cut(it.entry)
            .flatMap((s) => {
              return stmtEng.all({ entry: s })
            })
            .map(({ english }) => english)
            .join('; ') ||
          'unknown',
        type: it.type,
        direction: it.direction,
        description: it.description || '',
        tag: [it.tag || '', it.source || ''].filter((it) => it).join(' ')
      })

      out.push(
        new DbQuiz({
          ...it,
          id
        })
      )
    })

    return out
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

  constructor(public entry: Partial<IDbQuiz> & { id: string }) {
    if (!entry.id) {
      throw new Error('no entry id')
    }

    if (this.entry.nextReview) {
      this.entry.nextReview = new Date(this.entry.nextReview)
    }

    if (this.entry.lastRight) {
      this.entry.lastRight = new Date(this.entry.lastRight)
    }

    if (this.entry.lastWrong) {
      this.entry.lastWrong = new Date(this.entry.lastWrong)
    }
  }

  updateSRSLevel(df: number) {
    if (
      [
        this.entry.srsLevel,
        this.entry.rightStreak,
        this.entry.wrongStreak,
        this.entry.maxRight,
        this.entry.maxWrong
      ].some((it) => typeof it === 'undefined')
    ) {
      const r = g.server.db
        .prepare(
          /* sql */ `
      SELECT srsLevel, rightStreak, wrongStreak, maxRight, maxWrong
      FROM [${DbQuiz.tableName}]
      WHERE id = @id
    `
        )
        .get({ id: this.entry.id })

      if (!r) {
        throw new Error('entry not found by id')
      }

      this.entry = new DbQuiz(Object.assign(this.entry, r)).entry
    }

    const now = new Date()
    const getNextReview = (srsLevel: number) => {
      const dur = srsMap[srsLevel] || [1, 'h']
      return addDate(now)[dur[1]](dur[0])
    }

    this.entry.rightStreak = this.entry.rightStreak || 0
    this.entry.wrongStreak = this.entry.wrongStreak || 0
    this.entry.maxRight = this.entry.maxRight || 0
    this.entry.maxWrong = this.entry.maxWrong || 0

    if (df > 0) {
      this.entry.lastRight = now

      this.entry.rightStreak++
      this.entry.wrongStreak = 0

      if (this.entry.rightStreak > this.entry.maxRight) {
        this.entry.maxRight = this.entry.rightStreak
      }
    } else if (df < 0) {
      this.entry.lastWrong = now

      this.entry.wrongStreak++
      this.entry.rightStreak = 0

      if (this.entry.wrongStreak > this.entry.maxWrong) {
        this.entry.maxWrong = this.entry.wrongStreak
      }
    }

    this.entry.srsLevel = (this.entry.srsLevel || 0) + df
    if (this.entry.srsLevel < 0) {
      this.entry.srsLevel = 0
    }
    if (this.entry.srsLevel >= srsMap.length) {
      this.entry.srsLevel = srsMap.length - 1
    }

    if (df) {
      this.entry.nextReview = getNextReview(this.entry.srsLevel)
    } else {
      this.entry.nextReview = getNextReview(-1)
    }

    g.server.db
      .prepare<{
        id: string
        srsLevel: number
        nextReview: number
        lastRight: number | null
        lastWrong: number | null
        rightStreak: number
        wrongStreak: number
        maxRight: number
        maxWrong: number
      }>(
        /* sql */ `
      UPDATE [${DbQuiz.tableName}]
      SET
        srsLevel = @srsLevel,
        nextReview = @nextReview,
        lastRight = @lastRight,
        lastWrong = @lastWrong,
        rightStreak = @rightStreak,
        wrongStreak = @wrongStreak,
        maxRight = @maxRight,
        maxWrong = @maxWrong
      WHERE id = @id
    `
      )
      .run({
        id: this.entry.id,
        srsLevel: this.entry.srsLevel,
        nextReview: +this.entry.nextReview,
        lastRight:
          typeof this.entry.lastRight !== 'undefined'
            ? +this.entry.lastRight
            : null,
        lastWrong:
          typeof this.entry.lastWrong !== 'undefined'
            ? +this.entry.lastWrong
            : null,
        rightStreak: this.entry.rightStreak,
        wrongStreak: this.entry.wrongStreak,
        maxRight: this.entry.maxRight,
        maxWrong: this.entry.maxWrong
      })

    return this.entry
  }
}
