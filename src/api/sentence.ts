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

        const r = g.server.zh
          .prepare(
            /* sql */ `
        SELECT chinese, pinyin, english
        FROM sentence
        WHERE chinese = @entry
        `
          )
          .get({ entry })

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
        const { sentenceMin, sentenceMax, level, levelMin } = g.server.db
          .prepare(
            /* sql */ `
        SELECT
          json_extract(meta, '$.settings.sentence.min') sentenceMin,
          json_extract(meta, '$.settings.sentence.max') sentenceMax,
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
        WHERE [type] = 'sentence' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL
        `
          )
          .all()
          .map(({ entry }) => entry)

        const where: string[] = [`level >= @levelMin AND level <= @level`]

        if (sentenceMin) {
          where.push(`length(chinese) >= @sentenceMin`)
        }

        if (sentenceMax) {
          where.push(`length(chinese) <= @sentenceMax`)
        }

        const entriesSet = new Set(entries)

        let r = g.server.zh
          .prepare(
            /* sql */ `
        SELECT chinese result, english, [level]
        FROM sentence
        WHERE ${where.join(' AND ')}
        `
          )
          .all({ level, levelMin, sentenceMin, sentenceMax })
          .filter(({ result }) => !entriesSet.has(result))

        if (!r.length) {
          where.pop()

          r = g.server.zh
            .prepare(
              /* sql */ `
          SELECT chinese result, english, [level]
          FROM sentence
          WHERE ${where.join(' AND ')}
          `
            )
            .all({ level, levelMin, sentenceMin, sentenceMax })
            .filter(({ result }) => !entriesSet.has(result))
        }

        if (!r.length) {
          throw { statusCode: 404, message: 'no matching entries found' }
        }

        return r[Math.floor(Math.random() * r.length)]
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
          where.push(/* sql */ `chinese LIKE '%'||@q||'%'`)
        }

        const { sentenceMin, sentenceMax, level, levelMin } = g.server.db
          .prepare(
            /* sql */ `
        SELECT
          json_extract(meta, '$.settings.sentence.min') sentenceMin,
          json_extract(meta, '$.settings.sentence.max') sentenceMax
        FROM user
        `
          )
          .get()

        if (sentenceMin) {
          where.push(/* sql */ `length(chinese) >= @sentenceMin`)
        }

        if (sentenceMax) {
          where.push(/* sql */ `length(chinese) <= @sentenceMax`)
        }

        const { count = 0 } =
          g.server.zh
            .prepare(
              /* sql */ `
        SELECT COUNT(*) [count] FROM sentence
        WHERE ${where.join(' AND ') || 'TRUE'}
        `
            )
            .get({ q, level, levelMin, sentenceMax, sentenceMin }) || {}

        const result: {
          chinese: string
          english: string
        }[] = g.server.zh
          .prepare(
            /* sql */ `
        SELECT chinese, english FROM sentence
        WHERE ${where.join(' AND ') || 'TRUE'}
        ORDER BY frequency DESC
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
        `
          )
          .all({ q, level, levelMin, sentenceMax, sentenceMin })

        if (generate && result.length < generate) {
          const additional = g.server.db
            .prepare(
              /* sql */ `
          SELECT chinese, english FROM sentence
          WHERE ${where.join(' AND ') || 'TRUE'}
          LIMIT 10
          `
            )
            .all({ q, level, levelMin, sentenceMax, sentenceMin })

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

            const stmt = g.server.db.prepare(/* sql */ `
            INSERT INTO sentence (chinese, english) VALUES (@chinese, @english)
            ON CONFLICT DO NOTHING
            `)
            g.server.db.transaction(() => {
              scraped.map((s) => stmt.run(s))
            })()

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
