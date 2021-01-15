import sqlite3 from 'sqlite3'

export function mapAsync<T, R>(
  arr: T[],
  cb: (a: T, i: number) => R | Promise<R>
): Promise<R[]> {
  return Promise.all(arr.map(cb))
}

export const sql = (
  s: TemplateStringsArray,
  ...args: (SQLiteType | any[] | SQLTemplateString | undefined)[]
) => {
  return new SQLTemplateString(s, ...args)
}

export function sqlJoin(sqls: SQLTemplateString[], sep: string) {
  const [f1, ...fs] = sqls
  if (!f1) {
    return undefined
  }

  fs.map((f) => {
    f1.sql += sep
    f1.append(f)
  })

  return f1
}

export type SQLiteType = string | number | null | Buffer

export class SQLTemplateString {
  sql = ''
  map = new Map<number, SQLiteType>()

  constructor(
    s: TemplateStringsArray,
    ...args: (SQLiteType | any[] | SQLTemplateString | undefined)[]
  ) {
    s.map((ss, i) => {
      this.sql += ss
      this.append(args[i])
    })
  }

  append(a: SQLiteType | any[] | SQLTemplateString | undefined) {
    if (typeof a === 'undefined') {
      return
    }

    if (Array.isArray(a)) {
      this.sql += '('
      a.map((a0, j) => {
        if (j > 0) {
          this.sql += ','
        }
        this.sql += this.setValue(a0)
      })
      this.sql += ')'
    } else if (a instanceof SQLTemplateString) {
      this.sql += a.sql.replace(/\?(\d+)/g, (_, p1) => {
        const v = a.map.get(parseInt(p1))!
        return this.setValue(v)
      })
    } else {
      this.sql += this.setValue(a)
    }
  }

  setValue(v: SQLiteType) {
    const i = this.map.size + 1
    this.map.set(i, v)
    return `?${i}`
  }
}

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

  async get<R extends Record<string, SQLiteType>>(sql: SQLTemplateString) {
    const stmt = await this.prepare(sql)
    const { data } = await stmt.get<R>()
    await stmt.finalize()

    return data
  }

  async all<R extends Record<string, SQLiteType>>(sql: SQLTemplateString) {
    const stmt = await this.prepare(sql)
    const { data } = await stmt.all<R>()
    await stmt.finalize()

    return data
  }

  async run(sql: SQLTemplateString) {
    const stmt = await this.prepare(sql)
    await stmt.run()
    await stmt.finalize()
  }

  async prepare(sql: SQLTemplateString) {
    return new Promise<Statement>((resolve, reject) => {
      this.driver.prepare(sql.sql, function (e) {
        e ? reject(e) : resolve(new Statement(this, sql))
      })
    })
  }

  async exec(sql: SQLTemplateString) {
    return new Promise<Statement>((resolve, reject) => {
      this.driver.exec(sql.sql, function (e) {
        e ? reject(e) : resolve(new Statement(this, sql))
      })
    })
  }

  async transaction<R>(tx: () => Promise<R>) {
    await this.exec(sql`BEGIN TRANSACTION`)

    let data: R | null = null

    try {
      data = await tx()
      await this.exec(sql`COMMIT`)
    } catch (e) {
      await this.exec(sql`ROLLBACK`)
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

export class Statement {
  params: Record<string, SQLiteType>

  constructor(
    public stmt: sqlite3.Statement,
    templateString: SQLTemplateString
  ) {
    this.params = {}
    for (const [k, v] of templateString.map) {
      this.params[`?${k}`] = v
    }
  }

  async run() {
    return new Promise<{ meta: sqlite3.RunResult }>((resolve, reject) => {
      this.stmt.run(this.params, function (e) {
        e ? reject(e) : resolve({ meta: this })
      })
    })
  }

  async get<R extends Record<string, SQLiteType>>() {
    return new Promise<{ data: R | undefined; meta: sqlite3.RunResult }>(
      (resolve, reject) => {
        this.stmt.get(this.params, function (e, r) {
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

  async all<R extends Record<string, SQLiteType>>() {
    return new Promise<{ data: R[]; meta: sqlite3.RunResult }>(
      (resolve, reject) => {
        this.stmt.all(this.params, function (e, rs) {
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
