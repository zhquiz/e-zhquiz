import { DbExtra } from './extra'
import { DbLibrary } from './library'
import { DbQuiz } from './quiz'
import { DbSentence } from './sentence'
import { DbUser } from './user'

export class Database {
  static async init() {
    await Promise.all([
      DbUser.init(),
      DbExtra.init(),
      DbLibrary.init(),
      DbQuiz.init(),
      DbSentence.init()
    ])
  }
}
