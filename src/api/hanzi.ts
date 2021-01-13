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
      async (
        req,
        reply
      ): Promise<typeof sResponse.type | { error: string }> => {
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
          reply.status(404)
          return {
            error: 'not found'
          }
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
        WHERE [type] = 'hanzi' AND srsLevel IS NOT NULL AND nextReview IS NOT NULL
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
          `hanzi_level >= ${params.set(
            levelMin
          )} AND hanzi_level <= ${params.set(level)}`,
          'english IS NOT NULL'
        ]
        if (entries.length) {
          where.push(`entry NOT IN (${entries.map((it) => params.set(it))})`)
        }

        let r = g.server.zh
          .prepare(
            /* sql */ `
        SELECT [entry] result, english, hanzi_level [level]
        FROM token
        WHERE ${where.join(' AND ')}
        `
          )
          .all(params.get())

        if (!r.length) {
          where.pop()

          r = g.server.zh
            .prepare(
              /* sql */ `
          SELECT [entry] result, english, hanzi_level [level]
          FROM token
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

  next()
}

export default hanziRouter
