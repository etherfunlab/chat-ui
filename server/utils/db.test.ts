import { describe, it, expect, beforeEach } from 'vitest'
import { stubValidEnv } from '../../tests/helpers/env'

beforeEach(() => {
  stubValidEnv()
})

describe('getPool', () => {
  it('installs an error listener and caps pool size for serverless', async () => {
    const { getPool } = await import('./db')
    const pool = getPool()
    expect(pool.listenerCount('error')).toBe(1)
    expect(pool.options.max).toBe(3)
  })
})
