import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'

import { g } from '../shared'

const userRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  const selMap: Record<string, string> = {
    level: "json_extract(meta, '$.level') level",
    levelMin: "json_extract(meta, '$.levelMin') levelMin",
    forvo: "json_extract(meta, '$.forvo') forvo",
    'settings.quiz': "json_extract(meta, '$.settings.quiz') settings.quiz",
    'settings.level.whatToShow':
      "json_extract(meta, '$.settings.level.whatToShow') settings.level.whatToShow",
    'settings.sentence.min':
      "json_extract(meta, '$.settings.sentence.min') settings.sentence.min",
    'settings.sentence.max':
      "json_extract(meta, '$.settings.sentence.max') settings.sentence.max"
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
      async (
        req,
        reply
      ): Promise<typeof sResponse.type | { error: string }> => {
        const { select } = req.query

        const sel = select
          .split(' ')
          .map((s) => selMap[s.trim()])
          .filter((s) => s)

        if (!sel.length) {
          reply.status(400)
          return {
            error: 'not enough select'
          }
        }

        const result = g.server.db
          .prepare(
            /* sql */ `
        SELECT ${sel} FROM user
        `
          )
          .get()

        return result
      }
    )
  }

  {
    const sBody = S.shape({
      level: S.integer().minimum(1).maximum(60),
      levelMin: S.integer().minimum(1).maximum(60),
      sentenceMin: S.integer().minimum(2).maximum(20),
      sentenceMax: S.integer().minimum(2).maximum(20)
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
        g.server.db
          .prepare(
            /* sql */ `
        UPDATE user
        SET meta = json_set(
          json_set(
            json_set(
              json_set(
                meta,
                '$.settings.sentence.max', @sentenceMax
              ),
              '$.settings.sentence.min', @sentenceMin
            ),
            '$.level', @level
          ),
          '$.levelMin', @levelMin
        )
        `
          )
          .run(req.query)

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
