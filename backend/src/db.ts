// Database access for SQLite (default, zero setup) or Postgres (set DATABASE_URL, e.g. a free Neon
// database). Both expose the same small async API so the rest of the server doesn't care which.
import Database from 'better-sqlite3'
import pg from 'pg'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { config } from './config'

fs.mkdirSync(config.storageDir, { recursive: true })

export const isPostgres = !!config.databaseUrl
pg.types.setTypeParser(pg.types.builtins.INT8, val => Number(val))

let sqliteDb: Database.Database | null = null
let pgPool: pg.Pool | null = null
if (isPostgres) {
  pgPool = new pg.Pool({ connectionString: config.databaseUrl, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false }, max: 20, idleTimeoutMillis: 30000 })
  pgPool.on('error', e => console.error('[db] idle Postgres client error:', e.message))
} else {
  sqliteDb = new Database(config.dbFile)
  sqliteDb.pragma('journal_mode = WAL')
  sqliteDb.pragma('foreign_keys = ON')
  sqliteDb.pragma('busy_timeout = 5000')
}

/** Inside db.transaction(), Postgres queries must use the transaction's own connection. */
const txClient = new AsyncLocalStorage<pg.PoolClient>()
const pgQuery = (sql: string, values: any[]) => (txClient.getStore() ?? pgPool!).query(sql, values)

const isNamed = (params: any[]) => params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Date) && !Buffer.isBuffer(params[0])
function toPg(sql: string, params: any[]): { sql: string; values: any[] } {
  if (isNamed(params)) {
    const obj = params[0]; const values: any[] = []; let i = 1
    return { sql: sql.replace(/@([a-zA-Z0-9_]+)/g, (_, key) => { values.push(obj[key]); return `$${i++}` }), values }
  }
  let i = 1
  return { sql: sql.replace(/\?/g, () => `$${i++}`), values: params }
}
const sqliteArgs = (params: any[]) => (isNamed(params) ? [params[0]] : params)

export const db = {
  prepare(sql: string) {
    return {
      async get<T = any>(...params: any[]): Promise<T | undefined> {
        if (pgPool) { const q = toPg(sql, params); return (await pgQuery(q.sql, q.values)).rows[0] as T }
        return sqliteDb!.prepare(sql).get(...sqliteArgs(params)) as T
      },
      async all<T = any>(...params: any[]): Promise<T[]> {
        if (pgPool) { const q = toPg(sql, params); return (await pgQuery(q.sql, q.values)).rows as T[] }
        return sqliteDb!.prepare(sql).all(...sqliteArgs(params)) as T[]
      },
      async run(...params: any[]): Promise<{ changes: number }> {
        if (pgPool) { const q = toPg(sql, params); return { changes: (await pgQuery(q.sql, q.values)).rowCount ?? 0 } }
        return { changes: sqliteDb!.prepare(sql).run(...sqliteArgs(params)).changes }
      },
    }
  },
  async exec(sql: string): Promise<void> {
    if (pgPool) await pgQuery(sql, []); else sqliteDb!.exec(sql)
  },
  /** All-or-nothing. Every db call made inside `fn` is part of the transaction. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (pgPool) {
      if (txClient.getStore()) return fn() // already inside one
      const client = await pgPool.connect()
      try {
        await client.query('BEGIN')
        const res = await txClient.run(client, fn)
        await client.query('COMMIT')
        return res
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e } finally { client.release() }
    }
    // better-sqlite3 is synchronous, so its own transaction() can't wrap an async function.
    // A lock keeps transactions from interleaving; the body only awaits our synchronous queries.
    const prev = sqliteLock; let release!: () => void
    sqliteLock = new Promise<void>(r => { release = r })
    await prev
    try {
      sqliteDb!.exec('BEGIN IMMEDIATE')
      try { const res = await fn(); sqliteDb!.exec('COMMIT'); return res } catch (e) { if (sqliteDb!.inTransaction) sqliteDb!.exec('ROLLBACK'); throw e }
    } finally { release() }
  },
  async close() { if (pgPool) await pgPool.end(); else sqliteDb?.close() },
}
let sqliteLock: Promise<void> = Promise.resolve()

export async function initDb() {
  const BIG = isPostgres ? 'BIGINT' : 'INTEGER'
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass_hash TEXT NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}', created_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'empty', duration ${BIG} NOT NULL DEFAULT 0, head INTEGER NOT NULL DEFAULT 0,
      index_json TEXT, asset_json TEXT, error TEXT, created_at ${BIG} NOT NULL, updated_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS ops (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version INTEGER NOT NULL, id TEXT NOT NULL,
      author TEXT NOT NULL, run_id TEXT, label TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, at ${BIG} NOT NULL,
      PRIMARY KEY (project_id, version));
    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_name TEXT NOT NULL,
      size ${BIG} NOT NULL, part_size ${BIG} NOT NULL, parts_total INTEGER NOT NULL, received TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open', created_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, project_id TEXT, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, progress REAL NOT NULL DEFAULT 0, step TEXT,
      error TEXT, result TEXT, run_after ${BIG} NOT NULL DEFAULT 0, created_at ${BIG} NOT NULL, updated_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
      target TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0, segments_total INTEGER NOT NULL DEFAULT 0, segments_done INTEGER NOT NULL DEFAULT 0,
      file_path TEXT, size ${BIG}, duration ${BIG}, note TEXT, error TEXT, created_at ${BIG} NOT NULL, updated_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
      version INTEGER NOT NULL, state TEXT NOT NULL, created_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS shares (
      token TEXT PRIMARY KEY, render_id TEXT NOT NULL REFERENCES renders(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
      approved_by TEXT, approved_at ${BIG}, created_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, share_token TEXT NOT NULL REFERENCES shares(token) ON DELETE CASCADE, author TEXT NOT NULL,
      at_ms ${BIG} NOT NULL, body TEXT NOT NULL, created_at ${BIG} NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT,
      instruction TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
      ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, error TEXT, created_at ${BIG} NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, run_after);
    CREATE INDEX IF NOT EXISTS renders_user ON renders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS shares_render ON shares(render_id);
    CREATE INDEX IF NOT EXISTS agent_runs_user ON agent_runs(user_id, created_at);
  `)
  // columns added after the first release
  await addColumn('renders', 'options', 'TEXT')
}
async function addColumn(table: string, column: string, type: string) {
  if (isPostgres) { await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`); return }
  const cols = (await db.prepare(`PRAGMA table_info(${table})`).all()) as { name: string }[]
  if (!cols.some(c => c.name === column)) await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export const id = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url')
export const now = () => Date.now()
export const json = <T,>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback } catch { return fallback } }

export interface ProjectRow { id: string; user_id: string; title: string; status: string; duration: number; head: number; index_json: string | null; asset_json: string | null; error: string | null; created_at: number; updated_at: number }
export interface Asset { fileName: string; original?: string; proxy?: string; poster?: string; audio?: string; width?: number; height?: number; fps?: number; codec?: string; size?: number; synthetic?: boolean; demoFootage?: string; hasAudio?: boolean; hasVideo?: boolean; loudness?: number | null }
