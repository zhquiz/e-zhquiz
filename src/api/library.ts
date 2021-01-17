import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { DbLibrary } from '../db/library'
import { SQLTemplateString, sql, sqlJoin } from '../db/util'
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
      Querystring: typeof sQuerystring.type;
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

        const where: SQLTemplateString[] = []
        if (q) {
          where.push(sql`
          library.id IN (
            SELECT id FROM library_q WHERE library_q MATCH ${q}
          )
          `)
        }

        const { count = 0 } =
          (await g.server.db.get<{ count: number }>(
            sql`
              SELECT COUNT(*) [count]
              FROM library
              WHERE ${sqlJoin(where, ' AND ') || sql`TRUE`}
            `
          )) || {}

        const result = await g.server.db
          .all<{ id: string; title: string; entries: string }>(
            sql`
            SELECT id, title, entries
            FROM library
            ${
              q
                ? /* sql */ 'LEFT JOIN library_q ON library_q.id = library.id'
                : undefined
            }
            WHERE ${sqlJoin(where, ' AND ') || sql`TRUE`}
            ORDER BY ${
              q ? sql`rank GROUP BY library.id` : sql`library.updatedAt`
            }
            LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
          `
          )
          .then((rs) =>
            rs.map((r) => ({
              ...r,
              entries: JSON.parse(r.entries)
            }))
          )

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
      Body: typeof sBody.type;
    }>(
      '/',
      {
        schema: {
          body: sBody.valueOf()
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const [r] = await g.server.db.transaction(() =>
          DbLibrary.create([req.body])
        )

        return {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
      Querystring: typeof sQuerystring.type;
      Body: typeof sBody.type;
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
        g.server.db.transaction(() =>
          DbLibrary.update([
            {
              ...req.body,
              id: req.query.id
            }
          ])
        )

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
      Querystring: typeof sQuerystring.type;
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
        g.server.db.transaction(() => DbLibrary.delete([req.query.id]))

        return {
          result: 'deleted'
        }
      }
    )
  }

  next()
}

export default libraryRouter
