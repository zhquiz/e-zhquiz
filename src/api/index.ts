import { FastifyInstance } from 'fastify'

import chineseRouter from './chinese'
import extraRouter from './extra'
import hanziRouter from './hanzi'
import libraryRouter from './library'
import quizRouter from './quiz'

const apiRouter = (f: FastifyInstance, _: unknown, next: () => void) => {
  f.get('/isReady', async () => {
    return {}
  })

  f.register(chineseRouter, {
    prefix: '/chinese'
  })
  f.register(extraRouter, {
    prefix: '/extra'
  })
  f.register(hanziRouter, {
    prefix: '/hanzi'
  })
  f.register(libraryRouter, {
    prefix: '/library'
  })
  f.register(quizRouter, {
    prefix: '/quiz'
  })

  next()
}

export default apiRouter
