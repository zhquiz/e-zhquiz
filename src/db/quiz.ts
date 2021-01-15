import toPinyin from 'chinese-to-pinyin'
import { Ulid } from 'id128'
import { DurationUnit, addDate } from 'native-duration'
import jieba from 'nodejieba'

import { g } from '../shared'
import { sql } from './util'

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
  entry: string;
  pinyin?: string;
  english?: string;
  type: string;
  direction: string;
  source?: string;
  description?: string;
  tag?: string;
  srsLevel?: number;
  nextReview?: Date;
  lastRight?: Date;
  lastWrong?: Date;
  rightStreak?: number;
  wrongStreak?: number;
  maxRight?: number;
  maxWrong?: number;
}

export class DbQuiz {
  static tableName = 'quiz'

  static async init () {
    await g.server.db.exec(sql`
      CREATE TABLE IF NOT EXISTS [quiz] (
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_entry_type_direction ON [quiz]([entry], [type], direction);
      CREATE INDEX IF NOT EXISTS idx_quiz_source ON [quiz](source);
      CREATE INDEX IF NOT EXISTS idx_quiz_srsLevel ON [quiz](srsLevel);
      CREATE INDEX IF NOT EXISTS idx_quiz_nextReview ON [quiz](nextReview);
      CREATE INDEX IF NOT EXISTS idx_quiz_lastRight ON [quiz](lastRight);
      CREATE INDEX IF NOT EXISTS idx_quiz_lastWrong ON [quiz](lastWrong);
      CREATE INDEX IF NOT EXISTS idx_quiz_rightStreak ON [quiz](rightStreak);
      CREATE INDEX IF NOT EXISTS idx_quiz_wrongStreak ON [quiz](wrongStreak);
      CREATE INDEX IF NOT EXISTS idx_quiz_maxRight ON [quiz](maxRight);
      CREATE INDEX IF NOT EXISTS idx_quiz_maxWrong ON [quiz](maxWrong);

      CREATE TRIGGER IF NOT EXISTS t_quiz_updatedAt
        AFTER UPDATE ON [quiz]
        FOR EACH ROW
        WHEN NEW.updatedAt = OLD.updatedAt
        BEGIN
          UPDATE [quiz] SET updatedAt = strftime('%s','now') WHERE id = NEW.id;
        END;

      CREATE VIRTUAL TABLE IF NOT EXISTS quiz_q USING fts5(
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

  static async create (items: IDbQuiz[]) {
    const out: DbQuiz[] = []

    for (const it of items) {
      const id = Ulid.generate().toCanonical()

      await g.server.db.run(sql`
        INSERT INTO [quiz] (id, [entry], [type], direction, source)
        VALUES (${id}, ${it.entry}, ${it.type}, ${it.direction}, ${
        it.source || null
      })
      `)

      await g.server.db.run(sql`
        INSERT INTO quiz_q (id, [entry], pinyin, english, [type], direction, [description], tag)
        VALUES (
          ${id},
          ${it.entry},
          ${
            it.pinyin
              ? it.pinyin
                  .split(' ')
                  .map((s) => s.replace(/\d$/, ''))
                  .join(' ')
              : toPinyin(it.entry, { keepRest: true, toneToNumber: true })
          },
          ${
            it.english ||
            (
              await Promise.all(
                jieba.cut(it.entry).map(async (s) => {
                  return g.server.zh
                    .all(
                      sql`
                        SELECT english
                        FROM vocab
                        WHERE simplified = ${s} OR traditional = ${s}
                      `
                    )
                    .then((data) => data.map(({ english }) => english))
                })
              )
            )
              .flat()
              .join('; ') ||
            'unknown'
          },
          ${it.type},
          ${it.direction},
          ${it.description || ''},
          ${[it.tag || '', it.source || ''].filter((it) => it).join(' ')}
        )
      `)

      out.push(
        new DbQuiz({
          ...it,
          id
        })
      )
    }

    return out
  }

  static async delete (ids: string[]) {
    if (ids.length < 1) {
      throw new Error('nothing to delete')
    }

    await g.server.db.run(
      sql`
      DELETE FROM quiz_q
      WHERE id IN ${ids}
      `
    )

    await g.server.db.run(
      sql`
      DELETE FROM [quiz]
      WHERE id IN ${ids}
      `
    )
  }

  constructor (public entry: Partial<IDbQuiz> & { id: string }) {
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

  async updateSRSLevel (df: number) {
    if (
      [
        this.entry.srsLevel,
        this.entry.rightStreak,
        this.entry.wrongStreak,
        this.entry.maxRight,
        this.entry.maxWrong
      ].some((it) => typeof it === 'undefined')
    ) {
      const r = g.server.db.get(
        sql`
          SELECT srsLevel, rightStreak, wrongStreak, maxRight, maxWrong
          FROM [quiz]
          WHERE id = ${this.entry.id}
        `
      )

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

    this.entry.srsLevel = this.entry.srsLevel || 0
    this.entry.srsLevel = this.entry.srsLevel + df
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

    await g.server.db.run(
      sql`
      UPDATE [quiz]
      SET
        srsLevel = ${this.entry.srsLevel},
        nextReview = ${+this.entry.nextReview},
        lastRight = ${
          typeof this.entry.lastRight !== 'undefined'
            ? +this.entry.lastRight
            : null
        },
        lastWrong = ${
          typeof this.entry.lastWrong !== 'undefined'
            ? +this.entry.lastWrong
            : null
        },
        rightStreak = ${this.entry.rightStreak},
        wrongStreak = ${this.entry.wrongStreak},
        maxRight = ${this.entry.maxRight},
        maxWrong = ${this.entry.maxWrong}
      WHERE id = ${this.entry.id}
    `
    )

    return this.entry
  }
}
