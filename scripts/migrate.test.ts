import { describe, it, expect, vi } from 'vitest'
import { runMigrations } from './migrate'

function fakeClient(applied: string[] = [], failOn?: string) {
  const calls: { sql: string; params?: unknown[] }[] = []
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      if (failOn && sql === failOn) throw new Error('boom')
      if (/select name from schema_migrations/i.test(sql)) {
        return { rows: applied.map(name => ({ name })) }
      }
      return { rows: [] }
    }),
  }
}

const files = [
  { name: '0001_a.sql', sql: 'CREATE TABLE a ()' },
  { name: '0002_b.sql', sql: 'CREATE TABLE b ()' },
]

describe('runMigrations', () => {
  it('applies pending files in name order and records them', async () => {
    const c = fakeClient()
    const done = await runMigrations(c as never, [files[1]!, files[0]!])
    expect(done).toEqual(['0001_a.sql', '0002_b.sql'])
    const sqls = c.calls.map(x => x.sql)
    expect(sqls.indexOf('CREATE TABLE a ()')).toBeLessThan(sqls.indexOf('CREATE TABLE b ()'))
    expect(c.calls.some(x => /insert into schema_migrations/i.test(x.sql) && x.params?.[0] === '0001_a.sql')).toBe(true)
  })

  it('skips files already in schema_migrations', async () => {
    const c = fakeClient(['0001_a.sql'])
    const done = await runMigrations(c as never, files)
    expect(done).toEqual(['0002_b.sql'])
    expect(c.calls.map(x => x.sql)).not.toContain('CREATE TABLE a ()')
  })

  it('rolls back when a migration throws', async () => {
    const c = fakeClient([], 'CREATE TABLE b ()')
    await expect(runMigrations(c as never, files)).rejects.toThrow('boom')
    expect(c.calls.map(x => x.sql)).toContain('ROLLBACK')
    expect(c.calls.map(x => x.sql)).not.toContain('COMMIT')
  })
})
