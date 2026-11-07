import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'
import { RelayError } from '../../utils/upstream/errors'

stubH3Globals()

const assertSameOrigin = vi.fn()
const requireWallet = vi.fn()
const createApiKey = vi.fn()
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin }))
vi.mock('#server/utils/session', () => ({ requireWallet }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ marker: 'db' }) }))
vi.mock('#server/utils/apiKeys', () => ({ createApiKey }))

const { default: handler } = await import('./index.post')

beforeEach(() => {
  vi.clearAllMocks()
  requireWallet.mockResolvedValue('W')
  createApiKey.mockResolvedValue({ row: { id: 'k1', name: 'laptop' }, key: 'cu-plain' })
})

describe('POST /api/keys', () => {
  it('creates a key for the signed-in wallet and returns the plaintext once', async () => {
    const res = await handler(evt({ name: 'laptop' }))
    expect(createApiKey).toHaveBeenCalledWith({ marker: 'db' }, 'W', 'laptop')
    expect(res).toEqual({ row: { id: 'k1', name: 'laptop' }, key: 'cu-plain' })
  })

  it('rejects a name that is not a string', async () => {
    await expect(handler(evt({ name: 5 }))).rejects.toMatchObject({ statusCode: 400 })
    expect(createApiKey).not.toHaveBeenCalled()
  })

  it('maps a RelayError to its status and code', async () => {
    createApiKey.mockRejectedValueOnce(new RelayError(400, 'too_many_keys', 'x'))
    await expect(handler(evt({ name: 'laptop' }))).rejects.toMatchObject({ statusCode: 400, statusMessage: 'too_many_keys' })
  })

  it('rejects cross-origin requests before touching the database', async () => {
    assertSameOrigin.mockImplementationOnce(() => { throw Object.assign(new Error('x'), { statusCode: 403 }) })
    await expect(handler(evt({ name: 'laptop' }))).rejects.toMatchObject({ statusCode: 403 })
    expect(createApiKey).not.toHaveBeenCalled()
  })
})
