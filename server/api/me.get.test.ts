import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))

const getSessionWallet = vi.fn()
const query = vi.fn()
const getServerConfig = vi.fn(() => ({ billing: 'on' }))
vi.mock('#server/utils/session', () => ({ getSessionWallet }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ query }) }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))

const { default: handler } = await import('./me.get')

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/me', () => {
  it('returns 401 without a session', async () => {
    getSessionWallet.mockResolvedValue(null)
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('returns wallet, billing mode and available balance (balance minus holds)', async () => {
    getSessionWallet.mockResolvedValue('W1')
    query.mockResolvedValue({ rows: [{ available: '12345' }] })
    expect(await handler({} as never)).toEqual({ wallet: 'W1', billing: 'on', availableMicro: '12345' })
    expect(query.mock.calls[0]![0]).toMatch(/balance_micro\s*-\s*held_micro/)
  })

  it('returns zero available when the account row is missing', async () => {
    getSessionWallet.mockResolvedValue('W1')
    getServerConfig.mockReturnValueOnce({ billing: 'off' })
    query.mockResolvedValue({ rows: [] })
    expect(await handler({} as never)).toEqual({ wallet: 'W1', billing: 'off', availableMicro: '0' })
  })
})
