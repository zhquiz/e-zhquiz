import fs from 'fs'
import path from 'path'
import qs from 'querystring'
import stream from 'stream'

import ON_DEATH from 'death'
import fastify, { FastifyInstance } from 'fastify'
import jieba from 'nodejieba'
import pino from 'pino'
import sqlite3 from 'sqlite3'
import stripANSIStream from 'strip-ansi-stream'

import apiRouter from './api'
import { Database } from './db'
import { Driver } from './db/util'
import { g } from './shared'

interface IServerOptions {
  port: number;
  userDataDir: string;
  asarUnpack?: string;
}

interface IServerAssets {
  logger: pino.Logger;
  zh: Driver;
  db: Driver;
}

export class Server implements IServerOptions, IServerAssets {
  static async init (opts: IServerOptions) {
    if (opts.asarUnpack) {
      jieba.load({
        dict: path.join(
          opts.asarUnpack,
          'node_modules/nodejieba/dict/jieba.dict.utf8'
        ),
        userDict: path.join(
          opts.asarUnpack,
          'node_modules/nodejieba/dict/user.dict.utf8'
        ),
        hmmDict: path.join(
          opts.asarUnpack,
          'node_modules/nodejieba/dict/hmm_model.utf8'
        ),
        idfDict: path.join(
          opts.asarUnpack,
          'node_modules/nodejieba/dict/idf.utf8'
        ),
        stopWordDict: path.join(
          opts.asarUnpack,
          'node_modules/nodejieba/dict/stop_words.utf8'
        )
      })
    }

    const logThrough = new stream.PassThrough()

    const logger = pino(
      {
        prettyPrint: true,
        serializers: {
          req (req) {
            const [url, q] = req.url.split(/\?(.+)$/)
            const query = q ? qs.parse(q) : undefined

            return { method: req.method, url, query, hostname: req.hostname }
          }
        }
      },
      logThrough
    )

    logThrough
      .pipe(stripANSIStream())
      .pipe(fs.createWriteStream(path.join(opts.userDataDir, 'server.log')))
    logThrough.pipe(process.stdout)

    const zh = await Driver.open(
      path.join(opts.asarUnpack || 'public', 'assets', 'zh.db'),
      sqlite3.OPEN_READONLY
    )
    const db = await Driver.open(path.join(opts.userDataDir, 'data.db'))

    const app = fastify({
      logger
    })

    app.addHook('preHandler', (req, _, done) => {
      if (req.body) {
        req.log.info({ body: req.body }, 'parsed body')
      }
      done()
    })

    app.register(apiRouter, {
      prefix: '/api'
    })

    await new Promise<void>((resolve, reject) => {
      app.listen(opts.port, (err) => {
        if (err) {
          reject(err)
          return
        }

        resolve()
      })
    })

    g.server = new this(app, opts, { logger, zh, db })
    Database.init()

    return g.server
  }

  port: number
  userDataDir: string
  asarUnpack?: string

  logger: pino.Logger
  zh: Driver
  db: Driver

  private isCleanedUp = false

  private constructor (
    private app: FastifyInstance,
    opts: IServerOptions,
    assets: IServerAssets
  ) {
    this.port = opts.port
    this.userDataDir = opts.userDataDir
    this.asarUnpack = opts.asarUnpack

    this.logger = assets.logger
    this.zh = assets.zh
    this.db = assets.db

    ON_DEATH(() => {
      this.cleanup()
    })
  }

  async cleanup () {
    if (this.isCleanedUp) {
      return
    }
    this.isCleanedUp = true

    await this.app.close()

    this.db.close()
    this.zh.close()
  }
}
