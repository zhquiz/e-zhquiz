import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const hanziRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  {
    const sQuerystring = S.shape({
      entry: S.string()
    })

    const sResponse = S.shape({
      sub: S.string(),
      sup: S.string(),
      variants: S.string(),
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
        SELECT
          (
            SELECT GROUP_CONCAT(child, '') FROM token_sub WHERE parent = [entry] GROUP BY parent
          ) sub,
          (
            SELECT GROUP_CONCAT(child, '') FROM token_sup WHERE parent = [entry] GROUP BY parent
          ) sup,
          (
            SELECT GROUP_CONCAT(child, '') FROM token_var WHERE parent = [entry] GROUP BY parent
          ) variants,
          pinyin,
          english
        FROM token
        WHERE [entry] = @entry
        `
          )
          .get({ entry })

        if (!r) {
          throw { statusCode: 404, message: 'not found' }
        }

        return {
          sub: r.sub || '',
          sup: r.sup || '',
          variants: r.variants || '',
          pinyin: r.piyin || '',
          english: r.english || ''
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
        const entries: string[] = g.server.db
          .prepare(
            /* sql */ `
        SELECT [entry]
        FROM quiz
        WHERE [type] = 'hanzi' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL
        `
          )
          .all()
          .map(({ entry }) => entry)

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

        const where: string[] = []
        where.push(`hanzi_level >= @levelMin AND hanzi_level <= @level`)
        where.push('english IS NOT NULL')

        const entriesSet = new Set(entries)

        let r = g.server.zh
          .prepare(
            /* sql */ `
        SELECT [entry] result, english, hanzi_level [level]
        FROM token
        WHERE ${where.join(' AND ')}
        `
          )
          .all({ levelMin, level })
          .filter(({ result }) => !entriesSet.has(result))

        if (!r.length) {
          where.shift()

          r = g.server.zh
            .prepare(
              /* sql */ `
          SELECT [entry] result, english, hanzi_level [level]
          FROM token
          WHERE ${where.join(' AND ')}
          `
            )
            .all({ levelMin, level })
            .filter(({ result }) => !entriesSet.has(result))
        }

        if (!r.length) {
          throw { statusCode: 404, message: 'no mathcing entries found' }
        }

        return r[Math.floor(Math.random() * r.length)]
      }
    )
  }

  next()
}

export default hanziRouter
