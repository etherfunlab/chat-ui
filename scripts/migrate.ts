import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: { name: string }[] }>
}

export interface MigrationFile {
  name: string
  sql: string
}

/** Applies pending migrations in name order inside one transaction. */
export async function runMigrations(client: Queryable, files: MigrationFile[]): Promise<string[]> {
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  )
  const { rows } = await client.query('SELECT name FROM schema_migrations')
  const done = new Set(rows.map(r => r.name))
  const pending = [...files].sort((a, b) => a.name.localeCompare(b.name)).filter(f => !done.has(f.name))

  await client.query('BEGIN')
  try {
    for (const f of pending) {
      await client.query(f.sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f.name])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  return pending.map(f => f.name)
}

async function main() {
  const { default: pg } = await import('pg')
  const dir = fileURLToPath(new URL('../server/db/migrations', import.meta.url))
  const files = await Promise.all(
    (await readdir(dir)).filter(n => n.endsWith('.sql')).map(async name => ({
      name,
      sql: await readFile(join(dir, name), 'utf8'),
    })),
  )
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const applied = await runMigrations(client, files)
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date')
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main()
}
