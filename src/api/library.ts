import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const libraryRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  {
    const sQuerystring = S.shape({
      q: S.string().optional(),
      page: S.integer().minimum(1),
      perPage: S.integer().minimum(5)
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          id: S.string().optional(),
          title: S.string(),
          entries: S.list(S.string())
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
        const { q, page, perPage } = req.query

        const where: string[] = []
        if (q) {
          where.push(/* sql */ `
          library.id IN (
            SELECT id FROM library_q WHERE library_q MATCH @q
          )
          `)
        }

        const { count = 0 } =
          g.server.db
            .prepare(
              /* sql */ `
          SELECT COUNT(*) [count]
          FROM library
          WHERE ${where.join(' AND ') || 'TRUE'}
        `
            )
            .get({ q }) || {}

        const result = g.server.db
          .prepare(
            /* sql */ `
          SELECT id, title, entries
          FROM library
          ${
            q
              ? /* sql */ `LEFT JOIN library_q ON library_q.id = library.id`
              : ''
          }
          WHERE ${where.join(' AND ') || 'TRUE'}
          ORDER BY ${q ? 'rank GROUP BY library.id' : 'library.updatedAt'}
          LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
        `
          )
          .all({ q })
          .map((r) => ({
            ...r,
            entries: JSON.parse(r.entries)
          }))

        return {
          result,
          count
        }
      }
    )
  }

  next()
}

export default libraryRouter
