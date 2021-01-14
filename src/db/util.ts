import sqlite3 from 'sqlite3'

export function mapAsync<T, R>(
  arr: T[],
  cb: (a: T, i: number) => R | Promise<R>
): Promise<R[]> {
  return Promise.all(arr.map(cb))
}

export class Params {
  map = new Map<number, SQLiteType>()

  set(v: SQLiteType) {
    const i = this.map.size + 1
    this.map.set(i, v)
    return `?${i}`
  }

  get() {
    return Object.fromEntries(this.map)
  }
}

type SQLiteType = string | number | null | Buffer

export class Driver {
  static async open(
    filename: string,
    mode = sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE
  ) {
    return new Promise<Driver>((resolve, reject) => {
      const db: sqlite3.Database = new sqlite3.Database(filename, mode, (e) =>
        e ? reject(e) : resolve(new this(db, filename))
      )
    })
  }

  private constructor(
    public driver: sqlite3.Database,
    public filename: string
  ) {}

  async get<
    P extends Record<string, SQLiteType> | SQLiteType[],
    R extends Record<string, SQLiteType> = Record<string, SQLiteType>
  >(sql: string, params: P) {
    const stmt = await this.prepare<P>(sql)
    const { data } = await stmt.get<R>(params)
    await stmt.finalize()

    return data
  }

  async all<
    P extends Record<string, SQLiteType> | SQLiteType[],
    R extends Record<string, SQLiteType> = Record<string, SQLiteType>
  >(sql: string, params: P) {
    const stmt = await this.prepare<P>(sql)
    const { data } = await stmt.all<R>(params)
    await stmt.finalize()

    return data
  }

  async run<P extends Record<string, SQLiteType> | SQLiteType[]>(
    sql: string,
    params: P
  ) {
    const stmt = await this.prepare<P>(sql)
    await stmt.run(params)
    await stmt.finalize()
  }

  async prepare<P extends Record<string, SQLiteType> | SQLiteType[]>(
    sql: string
  ) {
    return new Promise<Statement<P>>((resolve, reject) => {
      this.driver.prepare(sql, function (e) {
        e ? reject(e) : resolve(new Statement(this))
      })
    })
  }

  async exec(sql: string) {
    return new Promise<Statement<any>>((resolve, reject) => {
      this.driver.exec(sql, function (e) {
        e ? reject(e) : resolve(new Statement(this))
      })
    })
  }

  async transaction<R>(tx: () => Promise<R>) {
    await this.exec('BEGIN TRANSACTION')

    let data: R | null = null

    try {
      data = await tx()
      await this.exec('COMMIT')
    } catch (e) {
      await this.exec('ROLLBACK')
      throw e
    }

    return data
  }

  async close() {
    return new Promise<void>((resolve, reject) => {
      this.driver.close((e) => (e ? reject(e) : resolve()))
    })
  }
}

export class Statement<P extends Record<string, SQLiteType> | SQLiteType[]> {
  constructor(public stmt: sqlite3.Statement) {}

  async run(params: P) {
    return new Promise<{ meta: sqlite3.RunResult }>((resolve, reject) => {
      this.stmt.run(params, function (e) {
        e ? reject(e) : resolve({ meta: this })
      })
    })
  }

  async get<R extends Record<string, SQLiteType>>(params: P) {
    return new Promise<{ data: R | undefined; meta: sqlite3.RunResult }>(
      (resolve, reject) => {
        this.stmt.get(params, function (e, r) {
          e
            ? reject(e)
            : resolve({
                data: r,
                meta: this
              })
        })
      }
    )
  }

  async all<R extends Record<string, SQLiteType>>(params: P) {
    return new Promise<{ data: R[]; meta: sqlite3.RunResult }>(
      (resolve, reject) => {
        this.stmt.all(params, function (e, rs) {
          e
            ? reject(e)
            : resolve({
                data: rs,
                meta: this
              })
        })
      }
    )
  }

  async finalize() {
    return new Promise<void>((resolve, reject) => {
      this.stmt.finalize((e) => {
        e ? reject(e) : resolve()
      })
    })
  }
}
