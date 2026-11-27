import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const requireWallet = vi.fn()
const listApiKeys = vi.fn()
vi.mock('#server/utils/session', () => ({ requireWallet }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ marker: 'db' }) }))
vi.mock('#server/utils/apiKeys', () => ({ listApiKeys }))

const { default: handler } = await import('./index.get')

beforeEach(() => {
  vi.clearAllMocks()
  requireWallet.mockResolvedValue('W')
  listApiKeys.mockResolvedValue([{ id: 'k1' }])
})

describe('GET /api/keys', () => {
  it('lists the signed-in wallet\'s keys', async () => {
    expect(await handler(evt())).toEqual({ keys: [{ id: 'k1' }] })
    expect(listApiKeys).toHaveBeenCalledWith({ marker: 'db' }, 'W')
  })

  it('requires a session', async () => {
    requireWallet.mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    await expect(handler(evt())).rejects.toMatchObject({ statusCode: 401 })
  })
})
