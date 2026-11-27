import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals } from '../../../tests/helpers/h3'

stubH3Globals()
const sendWebResponse = vi.fn((_e: unknown, res: Response) => res)
vi.stubGlobal('sendWebResponse', sendWebResponse)

const bearerHash = vi.fn()
const walletForKey = vi.fn()
const list = vi.fn()
vi.mock('#server/utils/v1', () => ({ bearerHash }))
vi.mock('#server/utils/apiKeys', () => ({ walletForKey }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({ marker: 'db' }) }))
vi.mock('#server/utils/config', () => ({ getServerConfig: () => ({ marker: 'config' }) }))
vi.mock('#server/utils/catalog', () => ({ getCatalog: () => ({ list }) }))

const { default: handler } = await import('./models.get')
const evt = {} as never
const run = async () => (await handler(evt)) as unknown as Response

beforeEach(() => {
  vi.clearAllMocks()
  bearerHash.mockReturnValue('h1')
  walletForKey.mockResolvedValue('W')
  list.mockResolvedValue([{ id: 'b-model' }, { id: 'a-model' }])
})

describe('GET /v1/models', () => {
  it('lists the catalog in display order for a valid key', async () => {
    const res = await run()
    expect(walletForKey).toHaveBeenCalledWith({ marker: 'db' }, { marker: 'config' }, 'h1')
    expect(await res.json()).toEqual({
      object: 'list',
      data: [{ id: 'b-model', object: 'model', created: 0, owned_by: 'venice' }, { id: 'a-model', object: 'model', created: 0, owned_by: 'venice' }],
    })
  })

  it('rejects a revoked key', async () => {
    walletForKey.mockResolvedValue(null)
    const res = await run()
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('invalid_api_key')
    expect(list).not.toHaveBeenCalled()
  })

  it('returns the 401 from bearerHash as is', async () => {
    const denied = new Response('{"error":{"code":"missing_api_key"}}', { status: 401 })
    bearerHash.mockReturnValue(denied)
    expect(await handler(evt)).toBe(denied)
    expect(walletForKey).not.toHaveBeenCalled()
  })

  it('answers 503 ledger_unavailable when the key lookup fails', async () => {
    walletForKey.mockRejectedValue(new Error('db down'))
    const res = await run()
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('ledger_unavailable')
  })

  it('answers 503 when the catalog is unavailable', async () => {
    list.mockRejectedValue(new Error('down'))
    const res = await run()
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('catalog_unavailable')
  })
})
