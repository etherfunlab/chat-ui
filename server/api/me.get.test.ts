import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))

const getSessionWallet = vi.fn()
const query = vi.fn()
vi.mock('#server/utils/session', () => ({ getSessionWallet }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ query }) }))

const { default: handler } = await import('./me.get')

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/me', () => {
  it('returns 401 without a session', async () => {
    getSessionWallet.mockResolvedValue(null)
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns wallet and balance as a string', async () => {
    getSessionWallet.mockResolvedValue('W1')
    query.mockResolvedValue({ rows: [{ balance_micro: '12345' }] })
    expect(await handler({} as never)).toEqual({ wallet: 'W1', balanceMicro: '12345' })
  })

  it('returns zero balance when the account row is missing', async () => {
    getSessionWallet.mockResolvedValue('W1')
    query.mockResolvedValue({ rows: [] })
    expect(await handler({} as never)).toEqual({ wallet: 'W1', balanceMicro: '0' })
  })
})
