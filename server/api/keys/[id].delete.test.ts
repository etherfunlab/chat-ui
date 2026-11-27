import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'id' ? 'k1' : undefined))

const assertSameOrigin = vi.fn()
const requireWallet = vi.fn()
const revokeApiKey = vi.fn()
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/session', () => ({ requireWallet }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ marker: 'db' }) }))
vi.mock('#server/utils/apiKeys', () => ({ revokeApiKey }))

const { default: handler } = await import('./[id].delete')

beforeEach(() => {
  vi.clearAllMocks()
  requireWallet.mockResolvedValue('W')
  revokeApiKey.mockResolvedValue(true)
})

describe('DELETE /api/keys/:id', () => {
  it('revokes the key named in the path for the signed-in wallet', async () => {
    expect(await handler(evt())).toEqual({ revoked: true })
    expect(revokeApiKey).toHaveBeenCalledWith({ marker: 'db' }, 'W', 'k1')
  })

  it('rejects cross-origin requests', async () => {
    assertSameOrigin.mockImplementationOnce(() => { throw Object.assign(new Error('x'), { statusCode: 403 }) })
    await expect(handler(evt())).rejects.toMatchObject({ statusCode: 403 })
    expect(revokeApiKey).not.toHaveBeenCalled()
  })
})
