import { describe, it, expect, vi } from 'vitest'
import { stubH3Globals } from '../../tests/helpers/h3'

stubH3Globals()
const list = vi.fn()
vi.mock('#server/utils/catalog', () => ({ getCatalog: () => ({ list }) }))

const { default: handler } = await import('./models.get')

describe('GET /api/models', () => {
  it('returns the catalog in configured order', async () => {
    list.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    expect(await handler({} as never)).toEqual({ models: [{ id: 'a' }, { id: 'b' }] })
  })

  it('answers 503 when the catalog never loaded', async () => {
    list.mockRejectedValue(new Error('model catalog unavailable'))
    await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 503 })
  })
})
