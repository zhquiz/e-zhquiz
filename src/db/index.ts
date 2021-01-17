import { DbExtra } from './extra'
import { DbLibrary } from './library'
import { DbQuiz } from './quiz'
import { DbSentence } from './sentence'
import { DbUser } from './user'

export class Database {
  static async init () {
    await DbUser.init()
    await DbExtra.init()
    await DbLibrary.init()
    await DbQuiz.init()
    await DbSentence.init()
  }
}
