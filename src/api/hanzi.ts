import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { SQLTemplateString, sql, sqlJoin } from '../db/util'
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
      Querystring: typeof sQuerystring.type;
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

        const r = await g.server.zh.get<{
          sub: string | null;
          sup: string | null;
          variants: string | null;
          pinyin: string | null;
          english: string | null;
        }>(
          sql`
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
          WHERE [entry] = ${entry}
          `
        )

        if (!r) {
          throw { statusCode: 404, message: 'not found' }
        }

        return {
          sub: r.sub || '',
          sup: r.sup || '',
          variants: r.variants || '',
          pinyin: r.pinyin || '',
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
        const entries: string[] = await g.server.db
          .all<{ entry: string }>(
            sql`
            SELECT [entry]
            FROM quiz
            WHERE [type] = 'hanzi' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL
            `
          )
          .then((rs) => rs.map(({ entry }) => entry))

        const { level, levelMin } =
          (await g.server.db.get<{
            level: number | null;
            levelMin: number | null;
          }>(
            sql`
            SELECT
              json_extract(meta, '$.level') [level],
              json_extract(meta, '$.levelMin') levelMin
            FROM user
            `
          )) || {}

        const where: SQLTemplateString[] = []
        where.push(
          sql`hanzi_level >= ${levelMin || 1} AND hanzi_level <= ${level || 60}`
        )
        where.push(sql`english IS NOT NULL`)

        const entriesSet = new Set(entries)

        let rs = await g.server.zh
          .all<{ result: string; english: string; level: number }>(
            sql`
            SELECT [entry] result, english, hanzi_level [level]
            FROM token
            WHERE ${sqlJoin(where, ' AND ')}
            `
          )
          .then((rs) => rs.filter(({ result }) => !entriesSet.has(result)))

        if (!rs.length) {
          where.shift()

          rs = await g.server.zh
            .all<{ result: string; english: string; level: number }>(
              sql`
              SELECT [entry] result, english, hanzi_level [level]
              FROM token
              WHERE ${sqlJoin(where, ' AND ')}
              `
            )
            .then((rs) => rs.filter(({ result }) => !entriesSet.has(result)))
        }

        const r = rs[Math.floor(Math.random() * rs.length)]

        if (!r) {
          throw { statusCode: 404, message: 'no mathcing entries found' }
        }

        return r
      }
    )
  }

  next()
}

export default hanziRouter
