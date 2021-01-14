import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { DbExtra } from '../db/extra'
import { g } from '../shared'

const extraRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, string> = {
    id: 'extra.id id',
    chinese: 'extra.chinese chinese',
    pinyin: 'extra_q.pinyin pinyin',
    english: 'extra_q.english english',
    type: 'extra_q.type [type]',
    description: 'extra_q.description description',
    tag: 'extra_q.tag tag'
  }

  {
    const sQuerystring = S.shape({
      q: S.string().optional(),
      select: S.string(),
      sort: S.string().optional(),
      page: S.integer().minimum(1),
      perPage: S.integer().minimum(5)
    })

    const sResponse = S.shape({
      result: S.list(S.object().additionalProperties(true)),
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
        const { q, select, sort = '-updatedAt', page, perPage } = req.query

        let sorter = sort
        let sortDirection = ''

        if (sort[0] === '-') {
          sorter = sorter.substr(1)
          sortDirection = ' DESC'
        }

        sorter =
          (({
            updatedAt: 'extra.updatedAt'
          } as Record<string, string>)[sorter] || 'extra.updatedAt') +
          sortDirection

        const sel = select
          .split(',')
          .map((s) => selMap[s.trim()])
          .filter((s) => s)

        if (!sel.length) {
          throw { statusCode: 400, message: 'not enough select' }
        }

        const where: string[] = []

        if (q) {
          where.push(/* sql */ `
          extra.id IN (
            SELECT id FROM extra_q WHERE extra_q MATCH $q
          )
          `)
        }

        try {
          const { count = 0 } =
            (await g.server.db.get<{ $q: string }, { count: number }>(
              /* sql */ `
              SELECT COUNT(*) [count]
              FROM extra
              WHERE ${where.join(' AND ') || 'TRUE'}
              `,
              { $q: q || '' }
            )) || {}

          const result = await g.server.db.all<{ $q: string }>(
            /* sql */ `
              SELECT ${sel}
              FROM extra
              LEFT JOIN extra_q ON extra_q.id = extra.id
              WHERE ${where.join(' AND ') || 'TRUE'}
              GROUP BY extra.id
              ORDER BY ${sorter}
              LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
              `,
            { $q: q || '' }
          )

          return {
            result,
            count
          }
        } catch (e) {
          g.server.logger.error(e)

          return {
            result: [],
            count: 0
          }
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      entry: S.string(),
      select: S.string()
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: S.object().additionalProperties(true).valueOf()
          }
        }
      },
      async (req, reply) => {
        const { entry, select } = req.query

        const sel = select
          .split(',')
          .map((s) => selMap[s.trim()])
          .filter((s) => s)

        if (!sel.length) {
          throw { statusCode: 400, message: 'not enough select' }
        }

        const result = await g.server.db.get<{ $entry: string }>(
          /* sql */ `
          SELECT ${sel}
          FROM extra
          LEFT JOIN extra_q ON extra_q.id = extra.id
          WHERE extra.chinese = $entry
          LIMIT 1
          GROUP BY extra.id
          `,
          { $entry: entry }
        )

        if (!result) {
          reply.status(404)
          throw { statusCode: 404, message: 'no entries found' }
        }

        return result
      }
    )
  }

  {
    const sQuerystring = S.shape({
      forced: S.boolean()
    })

    const sBody = S.shape({
      chinese: S.string(),
      pinyin: S.string(),
      english: S.string(),
      type: S.string(),
      description: S.string(),
      tag: S.string()
    })

    const sResponseExisting = S.shape({
      existing: S.shape({
        type: S.string(),
        entry: S.string()
      })
    })

    const sResponseNew = S.shape({
      id: S.string()
    })

    f.put<{
      Querystring: typeof sQuerystring.type
      Body: typeof sBody.type
    }>(
      '/',
      {
        schema: {
          body: sBody.valueOf(),
          response: {
            200: sResponseExisting.valueOf(),
            201: sResponseNew.valueOf()
          }
        }
      },
      async (
        req
      ): Promise<typeof sResponseNew.type | typeof sResponseExisting.type> => {
        const { chinese } = req.body

        const checkVocab = async () => {
          const r = await g.server.zh.get<
            { $chinese: string },
            { simplified: string }
          >(
            /* sql */ `
            SELECT simplified
            FROM vocab
            WHERE simplified = $chinese OR traditional = $chinese
            LIMIT 1
            `,
            { $chinese: chinese }
          )

          if (r) {
            return {
              existing: {
                type: 'vocab',
                entry: r.simplified
              }
            }
          }

          return null
        }

        const checkHanzi = async () => {
          if (chinese.length !== 1) {
            return null
          }

          const r = await g.server.zh.get<
            { $chinese: string },
            { entry: string }
          >(
            /* sql */ `
            SELECT [entry]
            FROM token
            WHERE [entry] = $chinese AND english IS NOT NULL
            LIMIT 1
            `,
            { $chinese: chinese }
          )

          if (r) {
            return {
              existing: {
                type: 'hanzi',
                entry: r.entry
              }
            }
          }

          return null
        }

        const checkSentence = async () => {
          if (chinese.length < 3) {
            return null
          }

          const r = await g.server.zh.get<
            { $chinese: string },
            { chinese: string }
          >(
            /* sql */ `
            SELECT chinese
            FROM sentence
            WHERE chinese = ?
            LIMIT 1
            `,
            { $chinese: chinese }
          )

          if (r) {
            return {
              existing: {
                type: 'sentence',
                entry: r.chinese
              }
            }
          }

          return null
        }

        if (!req.query.forced) {
          const r =
            (await checkVocab()) ||
            (await checkHanzi()) ||
            (await checkSentence())

          if (r) {
            return r
          }
        }

        const [r] = await g.server.db.transaction(() =>
          DbExtra.create([req.body])
        )

        return {
          id: r!.entry.id
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      id: S.string()
    })

    const sBody = S.shape({
      chinese: S.string(),
      pinyin: S.string(),
      english: S.string(),
      type: S.string(),
      description: S.string(),
      tag: S.string()
    })

    const sResponse = S.shape({
      result: S.string()
    })

    f.patch<{
      Querystring: typeof sQuerystring.type
      Body: typeof sBody.type
    }>(
      '/',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          body: sBody.valueOf(),
          response: {
            201: sResponse.valueOf()
          }
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { id } = req.query

        await g.server.db.transaction(() =>
          DbExtra.update([
            {
              ...req.body,
              id
            }
          ])
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
      id: S.string()
    })

    const sResponse = S.shape({
      result: S.string()
    })

    f.delete<{
      Querystring: typeof sQuerystring.type
    }>(
      '/',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            201: sResponse.valueOf()
          }
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { id } = req.query

        await g.server.db.transaction(() => DbExtra.delete([id]))

        reply.status(201)
        return {
          result: 'deleted'
        }
      }
    )
  }

  next()
}

export default extraRouter
