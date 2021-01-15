import shuffle from 'array-shuffle'
import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { DbExtra } from '../db/extra'
import { DbQuiz } from '../db/quiz'
import { SQLTemplateString, SQLiteType, sql, sqlJoin } from '../db/util'
import { g } from '../shared'

const quizRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, SQLTemplateString> = {
    id: sql`quiz.id id`,
    entry: sql`quiz.entry [entry]`,
    type: sql`quiz.type [type]`,
    direction: sql`quiz.direction direction`,
    source: sql`quiz.source source`
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
      Querystring: typeof sQuerystring.type;
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
      async (req): Promise<typeof sResponse.type> => {
        const {
          ids: _ids,
          entries: _entries,
          type,
          source,
          select: _select
        } = req.query
        const ids = _ids ? _ids.split(',') : []
        const entries = _entries ? _entries.split(',') : []

        const sel = _select
          .split(',')
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          .map((it) => selMap[it]!)
          .filter((it) => it)

        if (!sel.length) {
          throw { statusCode: 400, message: 'not enough select' }
        }

        const getResult = async (initialWhere: SQLTemplateString) => {
          const where = [initialWhere]

          if (type) {
            where.push(sql`
            quiz.type = ${type}
            `)
          }

          if (source) {
            where.push(sql`
            quiz.source = ${source}
            `)
          }

          return g.server.db.all(
            sql`
            SELECT ${sqlJoin(sel, ',')}
            FROM quiz
            WHERE ${sqlJoin(where, ' AND ')}
            `
          )
        }

        const promises: Promise<Record<string, SQLiteType>[]>[] = []

        const batchSize = 500
        if (ids.length) {
          for (let i = 0; i < ids.length; i += batchSize) {
            promises.push(getResult(sql`quiz.id IN ${ids}`))
          }
        } else if (entries.length) {
          for (let i = 0; i < entries.length; i += batchSize) {
            promises.push(getResult(sql`quiz.entry IN ${entries}`))
          }
        } else {
          throw {
            statusCode: 400,
            message: 'either ids or entries must be specified'
          }
        }

        const result = (await Promise.all(promises)).flat()

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
      Body: typeof sBody.type;
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

        const promises: Promise<
          { entry: string; srsLevel: number | null }[]
        >[] = []

        const chunkSize = 500
        for (let i = 0; i < entries.length; i += chunkSize) {
          const chunk = entries.slice(i, i + chunkSize)
          promises.push(
            g.server.db.all<{ entry: string; srsLevel: number | null }>(
              sql`
              SELECT [entry], srsLevel
              FROM quiz
              WHERE [type] = ${type} AND [entry] IN ${chunk}
              `
            )
          )
        }

        return {
          result: (await Promise.all(promises)).flat()
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
      Querystring: typeof sQuerystring.type;
    }>(
      '/mark',
      {
        schema: {
          querystring: sQuerystring.valueOf()
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { id, type } = req.query

        await g.server.db.transaction(() =>
          new DbQuiz({
            id
          }).updateSRSLevel(
            {
              right: 1,
              wrong: -1,
              repeat: 0
            }[type]
          )
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
      type: S.string(),
      stage: S.string(),
      direction: S.string(),
      q: S.string().optional(),
      includeUndue: S.boolean().optional(),
      includeExtra: S.boolean().optional()
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
      Querystring: typeof sQuerystring.type;
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
          includeUndue,
          includeExtra,
          q
        } = req.query

        const type = _type ? _type.split(',') : []
        const stage = _stage ? _stage.split(',') : []
        const direction = _direction ? _direction.split(',') : []

        if (!type.length || !stage.length || !direction.length) {
          return {
            quiz: [],
            upcoming: []
          }
        }

        /**
         * No need to await
         */
        g.server.db.run(
          sql`
            UPDATE user
            SET meta = json_set(meta, '$.settings.quiz', json(${JSON.stringify({
              type,
              stage,
              direction,
              includeUndue,
              includeExtra
            })}))
            `
        )

        const where: SQLTemplateString[] = []
        if (q) {
          where.push(sql`
            quiz.id IN (
              SELECT id FROM quiz_q WHERE quiz_q MATCH ${q}
            )
          `)
        }

        if (stage.length) {
          const orCond: SQLTemplateString[] = []

          if (stage.includes('new')) {
            orCond.push(sql`quiz.srsLevel IS NULL`)
          }

          if (stage.includes('learning')) {
            orCond.push(sql`quiz.srsLevel < 3`)
          }

          if (stage.includes('graduated')) {
            orCond.push(sql`quiz.graduated >= 3`)
          }

          where.push(sql`(${sqlJoin(orCond, ' OR ')})`)
        }

        if (!stage.includes('leech')) {
          where.push(sql`NOT (quiz.wrongStreak > 2)`)
        }

        if (!includeExtra) {
          where.push(sql`quiz.source IS NULL`)
        }

        where.push(
          sql`quiz.direction IN ${direction}`,
          sql`quiz.type IN ${type}`
        )

        const now = +new Date()
        const quiz: typeof sQuizEntry.type[] = []
        const upcoming: typeof sQuizEntry.type[] = []

        const allItems = await g.server.db.all<{
          id: string;
          wrongStreak: number | null;
          nextReview: number | null;
          srsLevel: number | null;
        }>(sql`
          SELECT
            quiz.id           id,
            quiz.wrongStreak  wrongStreak,
            quiz.nextReview   nextReview,
            quiz.srsLevel     srsLevel
          FROM quiz
          WHERE ${sqlJoin(where, ' AND ') || sql`FALSE`}
          `)

        allItems.map((r) => {
          if (!includeUndue) {
            if (!r.nextReview || r.nextReview < now) {
              quiz.push(r)
            } else {
              upcoming.push(r)
            }
          } else {
            quiz.push(r)
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
      Body: typeof sBody.type;
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

        const existing = await g.server.db.all<{
          id: string;
          entry: string;
          direction: string;
        }>(
          sql`
          SELECT id, [entry], direction
          FROM quiz
          WHERE [entry] IN ${entries} AND [type] = ${type}
          `
        )

        const result: {
          ids: string[];
          entry: string;
          type: string;
          source?: 'extra';
        }[] = []

        await g.server.db.transaction(async () => {
          for (const entry of entries) {
            const dirs = ['se', 'ec']
            const subresult: {
              ids: string[];
              entry: string;
              type: string;
              source?: 'extra';
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
                  const rs = await g.server.zh.all<{
                    traditional: string | null;
                  }>(sql`
                    SELECT DISTINCT traditional
                    FROM vocab
                    WHERE simplified = ${entry} OR traditional = ${entry}
                    `)

                  if (!rs.length) {
                    subresult.source = 'extra'
                  } else if (rs.some((r) => r.traditional)) {
                    dirs.push('te')
                  }
                  break
                case 'hanzi':
                  const rHanzi = await g.server.zh.get<{ entry: string }>(
                    sql`
                    SELECT [entry]
                    FROM token
                    WHERE [entry] = ${entry} AND english IS NOT NULL
                    `
                  )

                  if (!rHanzi) {
                    subresult.source = 'extra'
                  }
                  break
                case 'sentence':
                  const rSentence = await g.server.zh.get<{ chinese: string }>(
                    sql`
                    SELECT chinese
                    FROM sentence
                    WHERE chinese = ${entry}
                    `
                  )

                  if (!rSentence) {
                    subresult.source = 'extra'
                  }
              }
            }

            if (source !== 'extra' && subresult.source === 'extra') {
              try {
                await DbExtra.create([
                  {
                    chinese: subresult.entry
                  }
                ])
              } catch (e) {
                g.server.logger.error(e)
              }
            }

            for (const direction of dirs) {
              const ext = existing.find(
                (r) => r.entry === entry && r.direction === direction
              )

              if (ext) {
                subresult.ids.push(ext.id)
              } else {
                const [r] = await DbQuiz.create([
                  {
                    entry,
                    type,
                    direction,
                    source: subresult.source
                  }
                ])

                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                subresult.ids.push(r!.entry.id)
              }
            }
          }
        })

        reply.status(201)
        return {
          result
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      ids: S.string()
    })

    f.delete<{
      Querystring: typeof sQuerystring.type;
    }>(
      '/',
      {
        schema: {
          querystring: sQuerystring.valueOf()
        }
      },
      async (req, reply) => {
        const ids = req.query.ids.split(',')
        if (!req.query.ids || ids.length) {
          throw { statusCode: 400, message: 'not enough ids' }
        }

        await g.server.db.transaction(() => DbQuiz.delete(ids))

        reply.status(201)
        return {
          result: 'deleted'
        }
      }
    )
  }

  next()
}

export default quizRouter
