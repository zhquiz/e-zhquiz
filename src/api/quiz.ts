import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const quizRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, string> = {
    id: 'quiz.id id',
    entry: 'quiz.entry entry',
    type: 'quiz.type type',
    direction: 'quiz.direction direction'
  }

  {
    const sQuerystring = S.shape({
      ids: S.string().optional(),
      entries: S.string().optional(),
      type: S.string().enum('hanzi', 'vocab', 'sentence').optional(),
      source: S.string().optional(),
      select: S.string()
    })

    const sResponse = S.shape({
      result: S.list(S.object().additionalProperties(true))
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/many',
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
        const {
          ids: _ids,
          entries: _entries,
          type,
          source,
          select: _select
        } = req.query
        const ids = _ids ? _ids.split(/,/g) : []
        const entries = _entries ? _entries.split(/,/g) : []

        const select = _select
          .split(/,/g)
          .map((it) => selMap[it])
          .filter((it) => it)

        if (!select.length) {
          reply.status(400)
          return {
            error: 'not enough select'
          }
        }

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

        const where: string[] = []
        if (ids.length) {
          where.push(/* sql */ `
          quiz.id IN (${ids.map((it) => params.set(it))})
          `)
        } else if (entries.length) {
          where.push(/* sql */ `
          quiz.entry IN (${entries.map((it) => params.set(it))})
          `)
        } else {
          reply.status(400)
          return {
            error: 'either ids or entries must be specified'
          }
        }

        if (type) {
          where.push(/* sql */ `
          quiz.type = ${params.set(type)}
          `)
        }

        if (source) {
          where.push(/* sql */ `
          quiz.source = ${params.set(source)}
          `)
        } else {
          where.push(/* sql */ `
          quiz.source IS NULL
          `)
        }

        const result = g.server.db
          .prepare(
            /* sql */ `
        SELECT ${select}
        FROM quiz
        WHERE ${where.join(' AND ')}
        `
          )
          .all(params.get())

        return {
          result
        }
      }
    )
  }

  {
    const sBody = S.shape({
      entries: S.list(S.string()).minItems(1),
      type: S.string().enum('hanzi', 'vocab', 'sentence')
    })

    const sResponse = S.shape({
      result: S.list(
        S.shape({
          entry: S.string(),
          srsLevel: S.anyOf(S.integer(), S.null())
        })
      )
    })

    f.post<{
      Body: typeof sBody.type
    }>(
      '/srsLevel',
      {
        schema: {
          body: sBody.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        const { entries, type } = req.body

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

        const result = g.server.db
          .prepare(
            /* sql */ `
      SELECT [entry], srsLevel
      FROM quiz
      WHERE [entry] IN (${entries.map((it) =>
        params.set(it)
      )}) AND [type] = ${params.set(type)}
      `
          )
          .all()

        return {
          result
        }
      }
    )
  }

  next()
}

export default quizRouter
