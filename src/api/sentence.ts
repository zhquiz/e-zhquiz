import axios from 'axios'
import cheerio from 'cheerio'
import toPinyin from 'chinese-to-pinyin'
import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const sentenceRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  {
    const sQuerystring = S.shape({
      entry: S.string()
    })

    const sResponse = S.shape({
      chinese: S.string(),
      pinyin: S.string(),
      english: S.string()
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

        const r = await g.server.zh.get<
          { $entry: string },
          { chinese: string; pinyin: string; english: string }
        >(
          /* sql */ `
          SELECT chinese, pinyin, english
          FROM sentence
          WHERE chinese = $entry
          `,
          { $entry: entry }
        )

        if (!r) {
          throw { statusCode: 404, message: 'not found' }
        }

        return {
          chinese: r.chinese,
          pinyin:
            r.pinyin ||
            toPinyin(r.chinese, { keepRest: true, toneToNumber: true }),
          english: r.english
        }
      }
    )
  }

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
        const { sentenceMin, sentenceMax, level, levelMin } =
          (await g.server.db.get<
            any[],
            {
              sentenceMin: number | null
              sentenceMax: number | null
              level: number | null
              levelMin: number | null
            }
          >(
            /* sql */ `
          SELECT
            json_extract(meta, '$.settings.sentence.min') sentenceMin,
            json_extract(meta, '$.settings.sentence.max') sentenceMax,
            json_extract(meta, '$.level') [level],
            json_extract(meta, '$.levelMin') levelMin
          FROM user
        `,
            []
          )) || {}

        const entries = await g.server.db
          .all<any[], { entry: string }>(
            /* sql */ `
            SELECT [entry]
            FROM quiz
            WHERE [type] = 'sentence' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL
            `,
            []
          )
          .then((rs) => rs.map(({ entry }) => entry))

        const where: string[] = [`level >= $levelMin AND level <= $level`]

        if (sentenceMin) {
          where.push(`length(chinese) >= $sentenceMin`)
        }

        if (sentenceMax) {
          where.push(`length(chinese) <= $sentenceMax`)
        }

        const entriesSet = new Set(entries)

        console.log(/* sql */ `
        SELECT chinese result, english, [level]
        FROM sentence
        WHERE ${where.join(' AND ')}
        `)

        let rs = await g.server.zh
          .all<
            {
              $level: number
              $levelMin: number
              $sentenceMin: number
              $sentenceMax: number
            },
            { result: string; english: string; level: number }
          >(
            /* sql */ `
            SELECT chinese result, english, [level]
            FROM sentence
            WHERE ${where.join(' AND ')}
            `,
            {
              $level: level || 60,
              $levelMin: levelMin || 1,
              $sentenceMin: sentenceMin || 1,
              $sentenceMax: sentenceMax || 50
            }
          )
          .then((rs) => rs.filter(({ result }) => !entriesSet.has(result)))

        if (!rs.length) {
          where.pop()

          rs = await g.server.zh
            .all<
              {
                $level: number
                $levelMin: number
                $sentenceMin: number
                $sentenceMax: number
              },
              { result: string; english: string; level: number }
            >(
              /* sql */ `
              SELECT chinese result, english, [level]
              FROM sentence
              WHERE ${where.join(' AND ')}
              `,
              {
                $level: level || 60,
                $levelMin: levelMin || 1,
                $sentenceMin: sentenceMin || 1,
                $sentenceMax: sentenceMax || 50
              }
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

  {
    const sQuerystring = S.shape({
      q: S.string().optional(),
      page: S.integer().minimum(1).optional(),
      perPage: S.integer().minimum(5).optional(),
      generate: S.integer().minimum(5).optional()
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          chinese: S.string(),
          english: S.string()
        })
      ),
      count: S.integer().minimum(0)
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
        const { q, page = 1, perPage = 5, generate } = req.query

        const where: string[] = []
        if (q) {
          where.push(/* sql */ `chinese LIKE '%'||$q||'%'`)
        }

        const { sentenceMin, sentenceMax, level, levelMin } =
          (await g.server.db.get<
            any[],
            {
              sentenceMin: number | null
              sentenceMax: number | null
              level: number | null
              levelMin: number | null
            }
          >(
            /* sql */ `
            SELECT
              json_extract(meta, '$.settings.sentence.min') sentenceMin,
              json_extract(meta, '$.settings.sentence.max') sentenceMax,
              json_extract(meta, '$.level') [level],
              json_extract(meta, '$.levelMin') levelMin
            FROM user
            `,
            []
          )) || {}

        if (sentenceMin) {
          where.push(/* sql */ `length(chinese) >= $sentenceMin`)
        }

        if (sentenceMax) {
          where.push(/* sql */ `length(chinese) <= $sentenceMax`)
        }

        const { count = 0 } =
          (await g.server.zh.get<
            {
              $q: string
              $level: number
              $levelMin: number
              $sentenceMax: number
              $sentenceMin: number
            },
            { count: number }
          >(
            /* sql */ `
            SELECT COUNT(*) [count] FROM sentence
            WHERE ${where.join(' AND ') || 'TRUE'}
            `,
            {
              $q: q || '',
              $level: level || 60,
              $levelMin: levelMin || 1,
              $sentenceMax: sentenceMax || 50,
              $sentenceMin: sentenceMin || 1
            }
          )) || {}

        const result: {
          chinese: string
          english: string
        }[] = await g.server.zh.all<
          {
            $q: string
            $level: number
            $levelMin: number
            $sentenceMax: number
            $sentenceMin: number
          },
          { chinese: string; english: string }
        >(
          /* sql */ `
          SELECT chinese, english FROM sentence
          WHERE ${where.join(' AND ') || 'TRUE'}
          ORDER BY frequency DESC
          LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
          `,
          {
            $q: q || '',
            $level: level || 60,
            $levelMin: levelMin || 1,
            $sentenceMax: sentenceMax || 50,
            $sentenceMin: sentenceMin || 1
          }
        )

        if (generate && result.length < generate) {
          const additional = await g.server.db.all<
            {
              $q: string
              $level: number
              $levelMin: number
              $sentenceMax: number
              $sentenceMin: number
            },
            { chinese: string; english: string }
          >(
            /* sql */ `
            SELECT chinese, english FROM sentence
            WHERE ${where.join(' AND ') || 'TRUE'}
            LIMIT 10
            `,
            {
              $q: q || '',
              $level: level || 60,
              $levelMin: levelMin || 1,
              $sentenceMax: sentenceMax || 50,
              $sentenceMin: sentenceMin || 1
            }
          )

          result.push(...additional)

          if (result.length < generate) {
            let scraped: {
              chinese: string
              english: string
            }[] = []

            const html = await axios
              .get<string>(
                `http://www.jukuu.com/search.php?q=${encodeURIComponent(
                  q || ''
                )}`
              )
              .then((r) => r.data)
            const $ = cheerio.load(html)

            $('table tr.c td:last-child').each((i, el) => {
              const obj = scraped[i] || ({} as any)
              obj.chinese = $(el).text()
              scraped[i] = obj
            })

            $('table tr.e td:last-child').each((i, el) => {
              const obj = scraped[i] || ({} as any)
              obj.english = $(el).text()
            })

            scraped = scraped.filter((el) => el && el.chinese && el.english)

            const stmt = await g.server.db.prepare<{
              $chinese: string
              $english: string
            }>(/* sql */ `
            INSERT INTO sentence (chinese, english) VALUES ($chinese, $english)
            ON CONFLICT DO NOTHING
            `)

            await g.server.db.transaction(async () => {
              return Promise.all(
                scraped.map((s) =>
                  stmt.run({
                    $chinese: s.chinese,
                    $english: s.english
                  })
                )
              )
            })

            result.push(...scraped)
          }
        }

        return {
          result: result.slice(0, generate || perPage),
          count
        }
      }
    )
  }

  next()
}

export default sentenceRouter
