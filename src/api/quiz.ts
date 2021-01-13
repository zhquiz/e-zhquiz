import shuffle from 'array-shuffle'
import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { DbExtra } from '../db/extra'
import { DbQuiz } from '../db/quiz'
import { g } from '../shared'

const quizRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, string> = {
    id: 'quiz.id id',
    entry: 'quiz.entry entry',
    type: 'quiz.type type',
    direction: 'quiz.direction direction'
  }

  {
    const sQuerystring = S.shape({
      ids: S.string().optional(),
      entries: S.string().optional(),
      type: S.string().enum('hanzi', 'vocab', 'sentence').optional(),
      source: S.string().optional(),
      select: S.string()
    })

    const sResponse = S.shape({
      result: S.list(S.object().additionalProperties(true))
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/many',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (
        req,
        reply
      ): Promise<typeof sResponse.type | { error: string }> => {
        const {
          ids: _ids,
          entries: _entries,
          type,
          source,
          select: _select
        } = req.query
        const ids = _ids ? _ids.split(',') : []
        const entries = _entries ? _entries.split(',') : []

        const select = _select
          .split(',')
          .map((it) => selMap[it])
          .filter((it) => it)

        if (!select.length) {
          reply.status(400)
          return {
            error: 'not enough select'
          }
        }

        const params = {
          map: new Map<number, any>(),
          set(v: any) {
            const i = this.map.size + 1
            this.map.set(i, v)
            return `$${i}`
          },
          get() {
            return Object.fromEntries(this.map)
          }
        }

        const where: string[] = []
        if (ids.length) {
          where.push(/* sql */ `
          quiz.id IN (${ids.map((it) => params.set(it))})
          `)
        } else if (entries.length) {
          where.push(/* sql */ `
          quiz.entry IN (${entries.map((it) => params.set(it))})
          `)
        } else {
          reply.status(400)
          return {
            error: 'either ids or entries must be specified'
          }
        }

        if (type) {
          where.push(/* sql */ `
          quiz.type = ${params.set(type)}
          `)
        }

        if (source) {
          where.push(/* sql */ `
          quiz.source = ${params.set(source)}
          `)
        } else {
          where.push(/* sql */ `
          quiz.source IS NULL
          `)
        }

        const result = g.server.db
          .prepare(
            /* sql */ `
        SELECT ${select}
        FROM quiz
        WHERE ${where.join(' AND ')}
        `
          )
          .all(params.get())

        return {
          result
        }
      }
    )
  }

  {
    const sBody = S.shape({
      entries: S.list(S.string()).minItems(1),
      type: S.string().enum('hanzi', 'vocab', 'sentence')
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          entry: S.string(),
          srsLevel: S.anyOf(S.integer(), S.null())
        })
      )
    })

    f.post<{
      Body: typeof sBody.type
    }>(
      '/srsLevel',
      {
        schema: {
          body: sBody.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const { entries, type } = req.body

        const params = {
          map: new Map<number, any>(),
          set(v: any) {
            const i = this.map.size + 1
            this.map.set(i, v)
            return `$${i}`
          },
          get() {
            return Object.fromEntries(this.map)
          }
        }

        const result = g.server.db
          .prepare(
            /* sql */ `
      SELECT [entry], srsLevel
      FROM quiz
      WHERE [entry] IN (${entries.map((it) =>
        params.set(it)
      )}) AND [type] = ${params.set(type)}
      `
          )
          .all()

        return {
          result
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      id: S.string(),
      type: S.string().enum('right', 'wrong', 'repeat')
    })

    const sResponse = S.shape({
      result: S.string()
    })

    f.patch<{
      Querystring: typeof sQuerystring.type
    }>(
      '/mark',
      {
        schema: {
          querystring: sQuerystring.valueOf()
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { id, type } = req.query

        new DbQuiz({
          id
        }).updateSRSLevel(
          {
            right: 1,
            wrong: -1,
            repeat: 0
          }[type]
        )

        reply.status(201)
        return {
          result: 'updated'
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      type: S.string().optional(),
      stage: S.string().optional(),
      direction: S.string().optional(),
      isDue: S.boolean(),
      q: S.string()
    })

    const sQuizEntry = S.shape({
      id: S.string(),
      wrongStreak: S.anyOf(S.integer(), S.null()),
      srsLevel: S.anyOf(S.integer(), S.null()),
      nextReview: S.anyOf(S.integer(), S.null())
    })

    const sResponse = S.shape({
      quiz: S.list(sQuizEntry),
      upcoming: S.list(sQuizEntry)
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/init',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const {
          type: _type,
          stage: _stage,
          direction: _direction,
          isDue,
          q
        } = req.query

        const type = _type ? _type.split(',') : []
        const stage = _stage ? _stage.split(',') : []
        const direction = _direction ? _direction.split(',') : []

        g.server.db
          .prepare(
            /* sql */ `
        UPDATE user
        SET meta = json_set(
          meta.settings,
          json_set(COALESCE(meta.settings, json('{}')).quiz, json(?))
        )
        `
          )
          .run(JSON.stringify({ type, stage, direction, isDue }))

        const params = {
          map: new Map<number, any>(),
          set(v: any) {
            const i = this.map.size + 1
            this.map.set(i, v)
            return `$${i}`
          },
          get() {
            return Object.fromEntries(this.map)
          }
        }
        const where: string[] = []
        if (q) {
          where.push(/* sql */ `
          quiz.id IN (
            SELECT id FROM quiz_q WHERE quiz_q MATCH ${params.set(q)}
          )
          `)
        }

        const orCond: string[] = []
        if (stage.includes('new')) {
          orCond.push(/* sql */ `quiz.srsLevel IS NULL`)
        }

        if (stage.includes('learning')) {
          orCond.push(/* sql */ `quiz.srsLevel < 3`)
        }

        if (stage.includes('graduated')) {
          orCond.push(/* sql */ `quiz.graduated >= 3`)
        }

        if (orCond.length) {
          where.push(`(${orCond.join(' OR ')})`)
        }

        if (!stage.includes('leech')) {
          where.push(/* sql */ `NOT (quiz.wrongStreak > 2)`)
        }

        const now = +new Date()
        let quiz: typeof sQuizEntry.type[] = []
        let upcoming: typeof sQuizEntry.type[] = []

        g.server.db
          .prepare(
            /* sql */ `
        SELECT
          quiz.id           id,
          quiz.wrongStreak  wrongStreak,
          quiz.nextReview   nextReview,
          quiz.srsLevel     srsLevel
        FROM quiz
        WHERE ${where.join(' AND ') || 'FALSE'}
        `
          )
          .all(params.get())
          .map(({ id, wrongStreak, nextReview, srsLevel }) => {
            if (isDue || (!nextReview && nextReview < now)) {
              quiz.push({ id, wrongStreak, nextReview, srsLevel })
            } else {
              upcoming.push({ id, wrongStreak, nextReview, srsLevel })
            }
          })

        return {
          quiz: shuffle(quiz),
          upcoming: upcoming.sort(
            ({ nextReview: n1 }, { nextReview: n2 }) => (n1 || 0) - (n2 || 0)
          )
        }
      }
    )
  }

  {
    const sBody = S.shape({
      entries: S.list(S.string()).minItems(1),
      type: S.string().enum('hanzi', 'vocab', 'sentence'),
      source: S.string().enum('extra').optional()
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          ids: S.list(S.string()),
          type: S.string()
        })
      )
    })

    f.put<{
      Body: typeof sBody.type
    }>(
      '/',
      {
        schema: {
          body: sBody.valueOf(),
          response: {
            201: sResponse.valueOf()
          }
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { entries, type, source } = req.body

        const existing = g.server.db
          .prepare(
            /* sql */ `
        SELECT id, [entry], direction
        FROM quiz
        WHERE [entry] IN (${Array(entries.length).fill('?')}) AND [type] = ?
        `
          )
          .all(...entries, type) as {
          id: string
          entry: string
          direction: string
        }[]

        const result: {
          ids: string[]
          entry: string
          type: string
          source?: 'extra'
        }[] = []

        g.server.db.transaction(() => {
          entries.map((entry) => {
            const dirs = ['se', 'ec']
            const subresult: {
              ids: string[]
              entry: string
              type: string
              source?: 'extra'
            } = {
              ids: [],
              entry,
              type: 'vocab',
              source
            }
            result.push(subresult)

            if (!source) {
              switch (type) {
                case 'vocab':
                  const rs = g.server.zh
                    .prepare(
                      /* sql */ `
                    SELECT DISTINCT traditional
                    FROM vocab
                    WHERE simplified = @entry OR traditional = @entry
                    `
                    )
                    .all({ entry })

                  if (!rs.length) {
                    subresult.source = 'extra'
                  } else if (rs.some((r) => r.traditional)) {
                    dirs.push('te')
                  }
                  break
                case 'hanzi':
                  const rHanzi = g.server.zh
                    .prepare(
                      /* sql */ `
                  SELECT [entry]
                  FROM token
                  WHERE [entry] = @entry AND english IS NOT NULL
                  `
                    )
                    .get({ entry })

                  if (!rHanzi) {
                    subresult.source = 'extra'
                  }
                  break
                case 'sentence':
                  const rSentence = g.server.zh
                    .prepare(
                      /* sql */ `
                  SELECT chinese
                  FROM sentence
                  WHERE chinese = @entry
                  `
                    )
                    .get({ entry })

                  if (!rSentence) {
                    subresult.source = 'extra'
                  }
              }
            }

            if (subresult.source === 'extra') {
              try {
                DbExtra.create([
                  {
                    chinese: subresult.entry
                  }
                ])
              } catch (e) {
                g.server.logger.error(e)
              }
            }

            if (type === 'vocab' && !source) {
              const rs = g.server.zh
                .prepare(
                  /* sql */ `
            SELECT DISTINCT traditional
            FROM vocab
            WHERE simplified = @entry OR traditional = @entry
            `
                )
                .all({ entry })

              if (!rs.length) {
                subresult.source = 'extra'
              } else if (rs.some((r) => r.traditional)) {
                dirs.push('te')
              }
            }

            dirs.map((direction) => {
              const ext = existing.find(
                (r) => r.entry === entry && r.direction === direction
              )

              if (ext) {
                subresult.ids.push(ext.id)
              } else {
                const [r] = DbQuiz.create({
                  entry,
                  type,
                  direction,
                  source
                })

                subresult.ids.push(r!.entry.id)
              }
            })
          })
        })()

        reply.status(201)
        return {
          result
        }
      }
    )
  }

  next()
}

export default quizRouter
