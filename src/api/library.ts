import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { DbLibrary } from '../db/library'
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

  {
    const sBody = S.shape({
      title: S.string(),
      entries: S.list(S.string()).minItems(1),
      type: S.string().optional(),
      description: S.string().optional(),
      tag: S.string().optional()
    })

    const sResponse = S.shape({
      id: S.string()
    })

    f.put<{
      Body: typeof sBody.type
    }>(
      '/',
      {
        schema: {
          body: sBody.valueOf()
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const [r] = DbLibrary.create(req.body)

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
      title: S.string(),
      entries: S.list(S.string()).minItems(1),
      type: S.string().optional(),
      description: S.string().optional(),
      tag: S.string().optional()
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
      async (req): Promise<typeof sResponse.type> => {
        DbLibrary.update({
          ...req.body,
          id: req.query.id
        })

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
      async (req): Promise<typeof sResponse.type> => {
        DbLibrary.delete(req.query.id)

        return {
          result: 'deleted'
        }
      }
    )
  }

  next()
}

export default libraryRouter
