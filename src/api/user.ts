import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { SQLTemplateString, sql, sqlJoin } from '../db/util'
import { g } from '../shared'

const userRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, SQLTemplateString> = {
    level: sql`json_extract(meta, '$.level') [level]`,
    levelMin: sql`json_extract(meta, '$.levelMin') levelMin`,
    forvo: sql`json_extract(meta, '$.forvo') forvo`,
    'settings.quiz': sql`json_extract(meta, '$.settings.quiz') [settings.quiz]`,
    'settings.level.whatToShow': sql`json_extract(meta, '$.settings.level.whatToShow') [settings.level.whatToShow]`,
    'settings.sentence.min': sql`json_extract(meta, '$.settings.sentence.min') [settings.sentence.min]`,
    'settings.sentence.max': sql`json_extract(meta, '$.settings.sentence.max') [settings.sentence.max]`
  }

  {
    const sQuerystring = S.shape({
      select: S.string()
    })

    const sResponse = S.object().additionalProperties(true)

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
        const { select } = req.query

        const sel = select
          .split(',')
          .map((s) => selMap[s.trim()]!)
          .filter((s) => s)

        if (!sel.length) {
          throw { statusCode: 400, message: 'not enough select' }
        }

        const result = await g.server.db.get(
          sql`
          SELECT ${sqlJoin(sel, ',')} FROM user
          `
        )

        if (!result) {
          throw { statusCode: 401, message: 'not logged in' }
        }

        return result
      }
    )
  }

  {
    const sBody = S.shape({
      level: S.integer().minimum(1).maximum(60),
      levelMin: S.integer().minimum(1).maximum(60),
      sentenceMin: S.integer().minimum(2).maximum(20).optional(),
      sentenceMax: S.integer().minimum(2).maximum(20).optional()
    })

    const sResponse = S.shape({
      result: S.string()
    })

    f.patch<{
      Body: typeof sBody.type
    }>(
      '/',
      {
        schema: {
          body: sBody.valueOf(),
          response: {
            201: sResponse.valueOf()
          }
        }
      },
      async (req, reply): Promise<typeof sResponse.type> => {
        const { level, levelMin, sentenceMax, sentenceMin } = req.body

        await g.server.db.transaction(async () => {
          if (level) {
            await g.server.db.run(
              sql`
              UPDATE user
              SET meta = json_set(meta, '$.level', ${level})
              `
            )
          }

          if (levelMin) {
            await g.server.db.run(
              sql`
              UPDATE user
              SET meta = json_set(meta, '$.levelMin', ${levelMin})
              `
            )
          }

          if (sentenceMax) {
            await g.server.db.run(
              sql`
              UPDATE user
              SET meta = json_set(meta, '$.settings.sentence.max', ${sentenceMax})
              `
            )
          }

          if (sentenceMin) {
            await g.server.db.run(
              sql`
              UPDATE user
              SET meta = json_set(meta, '$.settings.sentence.min', ${sentenceMin})
              `
            )
          }
        })

        reply.status(201)
        return {
          result: 'updated'
        }
      }
    )
  }

  next()
}

export default userRouter
