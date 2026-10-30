import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', 'postgres://localhost/test')
  vi.stubEnv('SESSION_SECRET', 's'.repeat(32))
  vi.stubEnv('VENICE_API_KEY', 'vk')
  vi.stubEnv('BILLING', '')
})

describe('getPool', () => {
  it('installs an error listener and caps pool size for serverless', async () => {
    const { getPool } = await import('./db')
    const pool = getPool()
    expect(pool.listenerCount('error')).toBe(1)
    expect(pool.options.max).toBe(3)
  })
})
