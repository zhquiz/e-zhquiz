import { FastifyInstance } from 'fastify'
import S from 'jsonschema-definer'
import Text2Speech from 'node-gtts'
import jieba from 'nodejieba'

const chineseRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  {
    const sQuerystring = S.shape({
      q: S.string()
    })

    const sResponse = S.shape({
      result: S.list(S.string())
    })

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/jieba',
      {
        schema: {
          querystring: sQuerystring.valueOf(),
          response: {
            200: sResponse.valueOf()
          }
        }
      },
      async (req): Promise<typeof sResponse.type> => {
        return {
          result: jieba.cutForSearch(req.query.q)
        }
      }
    )
  }

  {
    const sQuerystring = S.shape({
      q: S.string()
    })

    const gtts = Text2Speech('zh')

    f.get<{
      Querystring: typeof sQuerystring.type
    }>(
      '/speak',
      {
        schema: {
          querystring: sQuerystring.valueOf()
        }
      },
      (req, reply) => {
        reply.send(gtts.stream(req.query.q))
      }
    )
  }

  next()
}

export default chineseRouter
