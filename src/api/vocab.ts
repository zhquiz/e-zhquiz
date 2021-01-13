import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const vocabRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  {
    const sQuerystring = S.shape({
      entry: S.string()
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          simplified: S.string(),
          traditional: S.anyOf(S.string(), S.null()),
          pinyin: S.string(),
          english: S.string()
        })
      )
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const { entry } = req.query

        const result = g.server.zh
          .prepare(
            /* sql */ `
        SELECT simplified, traditional, pinyin, english
        FROM vocab
        WHERE simplified = @entry OR traditional = @entry
        `
          )
          .all({ entry })

        return {
          result
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      q: S.string()
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          simplified: S.string(),
          traditional: S.anyOf(S.string(), S.null()),
          pinyin: S.string(),
          english: S.string()
        })
      )
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/q',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const { q } = req.query

        const result = g.server.zh
          .prepare(
            /* sql */ `
        SELECT simplified, traditional, pinyin, english
        FROM vocab
        WHERE simplified LIKE '%'||@q||'$' OR traditional LIKE '%'||@q||'%'
        `
          )
          .all({ q })

        return {
          result
        }
      }
    )
  }

  {
    const sResponse = S.shape({
      result: S.list(
        S.shape({
          entry: S.string(),
          level: S.integer(),
          srsLevel: S.integer().optional()
        })
      )
    })

    f.get(
      '/level',
      {
        schema: {
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (): Promise<typeof sResponse.type> => {
        const srsLevelMap = g.server.db
          .prepare(
            /* sql */ `
        SELECT [entry], srsLevel
        FROM quiz
        WHERE [type] = 'vocab' AND source IS NULL AND srsLevel IS NOT NULL
        `
          )
          .all()
          .reduce(
            (prev, { entry, srsLevel }) => ({ ...prev, [entry]: srsLevel }),
            {} as Record<string, number>
          )

        const result = g.server.zh
          .prepare(
            /* sql */ `
        SELECT [entry], vocab_level [level]
        FROM token
        WHERE vocab_level IS NOT NULL
        `
          )
          .all()
          .map((r) => {
            return {
              ...r,
              srsLevel: srsLevelMap[r.entry]
            }
          })

        return {
          result
        }
      }
    )
  }

  {
    {
      const sResponse = S.shape({
        result: S.string(),
        english: S.string(),
        level: S.integer()
      })

      f.get(
        '/random',
        {
          schema: {
            response: {
              200: sResponse.valueOf()
            }
          }
        },
        async (): Promise<typeof sResponse.type> => {
          const { level, levelMin } = g.server.db
            .prepare(
              /* sql */ `
          SELECT
            json_extract(meta, '$.level') [level],
            json_extract(meta, '$.levelMin') levelMin
          FROM user
          `
            )
            .get()

          const entries: string[] = g.server.db
            .prepare(
              /* sql */ `
          SELECT [entry]
          FROM quiz
          WHERE [type] = 'vocab' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL AND source IS NULL
          `
            )
            .all()
            .map(({ entry }) => entry)

          const where: string[] = [
            `vocab_level >= @levelMin AND vocab_level <= @level`
          ]

          const entriesSet = new Set(entries)

          let r = g.server.zh
            .prepare(
              /* sql */ `
          SELECT [entry] result, english, vocab_level [level]
          FROM token
          WHERE ${where.join(' AND ')}
          `
            )
            .all({ level, levelMin })
            .filter(({ result }) => !entriesSet.has(result))

          if (!r.length) {
            where.shift()

            r = g.server.zh
              .prepare(
                /* sql */ `
            SELECT [entry] result, english, vocab_level [level]
            FROM token
            WHERE ${where.join(' AND ')}
            `
              )
              .all({ level, levelMin })
              .filter(({ result }) => !entriesSet.has(result))
          }

          if (!r.length) {
            throw { statusCode: 404, message: 'no matching entries found' }
          }

          return r[Math.floor(Math.random() * r.length)]
        }
      )
    }
  }

  next()
}

export default vocabRouter
