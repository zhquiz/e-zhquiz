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
      async (
        req,
        reply
      ): Promise<typeof sResponse.type | { error: string }> => {
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
          reply.status(404)
          return {
            error: 'not found'
          }
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
    const sQuerystring = S.shape({
      level: S.integer().minimum(1).maximum(60),
      levelMin: S.integer().minimum(1).maximum(60)
    })

    const sResponse = S.shape({
      result: S.string(),
      english: S.string(),
      level: S.integer()
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/random',
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
        const { level, levelMin } = req.query

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

        const where: string[] = [
          `level >= ${params.set(levelMin)} AND level <= ${params.set(level)}`
        ]
        if (entries.length) {
          where.push(`chinese NOT IN (${entries.map((it) => params.set(it))})`)
        }

        let r = g.server.zh
          .prepare(
            /* sql */ `
        SELECT chinese result, english, [level]
        FROM sentence
        WHERE ${where.join(' AND ')}
        `
          )
          .all(params.get())

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
            .all(params.get())
        }

        if (!r.length) {
          reply.status(201)
          return {
            error: 'no matching entries found'
          }
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
      generate: S.integer().minimum(5).optional(),
      level: S.integer().minimum(1).maximum(60).optional(),
      levelMin: S.integer().minimum(1).maximum(60).optional()
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
        const {
          q,
          page = 1,
          perPage = 5,
          generate,
          level,
          levelMin
        } = req.query

        const where: string[] = []
        if (q) {
          where.push(/* sql */ `chinese LIKE '%'||@q||'%'`)
        }

        if (level && levelMin) {
          where.push(/* sql */ `[level] <= @level AND [level] >= @levelMin`)
        }

        const { sentenceMin, sentenceMax } = g.server.db
          .prepare(
            /* sql */ `
        SELECT
          json_extract(meta, '$.settings.sentence.min') sentenceMin,
          json_extract(meta, '$.settings.sentence.max') sentenceMax
        FROM user
        `
          )
          .get()

        if (sentenceMin && sentenceMax) {
          where.push(
            /* sql */ `length(chinese) <= @sentenceMax AND length(chinese) >= @sentenceMin`
          )
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
          .all({ q, level, levelMin })

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
