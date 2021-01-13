import { FastifyInstance } from 'fastify'

import chineseRouter from './chinese'
import extraRouter from './extra'
import hanziRouter from './hanzi'
import libraryRouter from './library'
import quizRouter from './quiz'
import sentenceRouter from './sentence'
import userRouter from './user'
import vocabRouter from './vocab'

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
  f.register(sentenceRouter, {
    prefix: '/sentence'
  })
  f.register(userRouter, {
    prefix: '/user'
  })
  f.register(vocabRouter, {
    prefix: '/vocab'
  })

  next()
}

export default apiRouter
