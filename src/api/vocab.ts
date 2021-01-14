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

        const result = await g.server.zh.all<
          { $entry: string },
          {
            simplified: string
            traditional: string | null
            pinyin: string
            english: string
          }
        >(
          /* sql */ `
        SELECT simplified, traditional, pinyin, english
        FROM vocab
        WHERE simplified = $entry OR traditional = $entry
        `,
          { $entry: entry }
        )

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

        const result = await g.server.zh.all<
          { $q: string },
          {
            simplified: string
            traditional: string | null
            pinyin: string
            english: string
          }
        >(
          /* sql */ `
          SELECT simplified, traditional, pinyin, english
          FROM vocab
          WHERE simplified LIKE '%'||$q||'$' OR traditional LIKE '%'||$q||'%'
          `,
          { $q: q }
        )

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
        const srsLevelMap = await g.server.db
          .all<any[], { entry: string; srsLevel: number }>(
            /* sql */ `
            SELECT [entry], srsLevel
            FROM quiz
            WHERE [type] = 'vocab' AND source IS NULL AND srsLevel IS NOT NULL
            `,
            []
          )
          .then((rs) =>
            rs.reduce(
              (prev, { entry, srsLevel }) => ({ ...prev, [entry]: srsLevel }),
              {} as Record<string, number>
            )
          )

        const result = await g.server.zh
          .all<any[], { entry: string; level: number }>(
            /* sql */ `
            SELECT [entry], vocab_level [level]
            FROM token
            WHERE vocab_level IS NOT NULL
            `,
            []
          )
          .then((rs) =>
            rs.map((r) => {
              return {
                ...r,
                srsLevel: srsLevelMap[r.entry]
              }
            })
          )

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
          const { level, levelMin } =
            (await g.server.db.get<
              any[],
              { level: number | null; levelMin: number | null }
            >(
              /* sql */ `
            SELECT
              json_extract(meta, '$.level') [level],
              json_extract(meta, '$.levelMin') levelMin
            FROM user
            `,
              []
            )) || {}

          const entries: string[] = await g.server.db
            .all<{ $level: number; $levelMin: number }, { entry: string }>(
              /* sql */ `
            SELECT [entry]
            FROM quiz
            WHERE [type] = 'vocab' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL AND source IS NULL
            `,
              { $level: level || 60, $levelMin: levelMin || 1 }
            )
            .then((rs) => rs.map(({ entry }) => entry))

          const where: string[] = [
            `vocab_level >= $levelMin AND vocab_level <= $level`
          ]

          const entriesSet = new Set(entries)

          let rs = await g.server.zh
            .all<
              { $level: number; $levelMin: number },
              { result: string; english: string; level: number }
            >(
              /* sql */ `
              SELECT [entry] result, english, vocab_level [level]
              FROM token
              WHERE ${where.join(' AND ')}
              `,
              { $level: level || 60, $levelMin: levelMin || 1 }
            )
            .then((rs) => rs.filter(({ result }) => !entriesSet.has(result)))

          if (!rs.length) {
            where.shift()

            rs = await g.server.zh
              .all<
                { $level: number; $levelMin: number },
                { result: string; english: string; level: number }
              >(
                /* sql */ `
              SELECT [entry] result, english, vocab_level [level]
              FROM token
              WHERE ${where.join(' AND ')}
              `,
                { $level: level || 60, $levelMin: levelMin || 1 }
              )
              .then((rs) => rs.filter(({ result }) => !entriesSet.has(result)))
          }

          const r = rs[Math.floor(Math.random() * rs.length)]

          if (!r) {
            throw { statusCode: 404, message: 'no matching entries found' }
          }

          return r
        }
      )
    }
  }

  next()
}

export default vocabRouter
