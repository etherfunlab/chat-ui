import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stubH3Globals, evt } from '../../../tests/helpers/h3'

stubH3Globals()

const requireWallet = vi.fn(async () => 'W')
const getServerConfig = vi.fn()
const buildTopUpTransaction = vi.fn()
const createIntent = vi.fn()
vi.mock('#server/utils/session', () => ({ requireWallet }))
vi.mock('#server/utils/sameOrigin', () => ({ assertSameOrigin: vi.fn() }))
vi.mock('#server/utils/config', () => ({ getServerConfig }))
vi.mock('#server/utils/db', () => ({ getPool: () => ({}) }))
vi.mock('#server/utils/topups', () => ({ createIntent }))
vi.mock('#server/utils/solana', async (orig) => ({
  usdcBaseUnits: (await orig<typeof import('#server/utils/solana')>()).usdcBaseUnits,
  getSolanaConnection: () => ({}),
  buildTopUpTransaction,
}))

const { default: handler } = await import('./intent.post')

beforeEach(() => {
  vi.clearAllMocks()
  getServerConfig.mockReturnValue({ billing: 'on', solanaTreasury: 'T', usdcMint: 'M' })
  buildTopUpTransaction.mockResolvedValue({ reference: 'R', transactionBase64: 'TX', blockhash: 'B', lastValidBlockHeight: 9 })
})

describe('POST /api/topup/intent', () => {
  it('builds a transfer from the session wallet and records the intent', async () => {
    const out = await handler(evt({ amount: '12.5' }))
    expect(buildTopUpTransaction).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'W', recipient: 'T', usdcMint: 'M', amountBase: 12_500_000n,
    }))
    expect(createIntent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      wallet: 'W', amountBase: 12_500_000n, reference: 'R', recipient: 'T', mint: 'M', blockhash: 'B', lastValidBlockHeight: 9,
    }))
    expect(out).toEqual({ intentId: expect.any(String), transactionBase64: 'TX' })
  })

  it('intent rejects 0.5 and 10001', async () => {
    for (const amount of ['0.5', '10001', 'abc', '1e2']) {
      await expect(handler(evt({ amount })), amount).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(createIntent).not.toHaveBeenCalled()
  })

  it('intent 404 when billing off', async () => {
    getServerConfig.mockReturnValue({ billing: 'off' })
    await expect(handler(evt({ amount: '5' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('maps a wallet without enough USDC to 402 insufficient_funds', async () => {
    buildTopUpTransaction.mockRejectedValue(Object.assign(new Error('x'), { cause: { message: 'insufficient funds' } }))
    await expect(handler(evt({ amount: '5' }))).rejects.toMatchObject({ statusCode: 402, data: { code: 'insufficient_funds' } })
    expect(createIntent).not.toHaveBeenCalled()
  })

  it('maps a wallet that never held USDC or SOL to 402 insufficient_funds', async () => {
    const cases = [
      Object.assign(new Error(''), { name: 'TokenAccountNotFoundError' }),
      Object.assign(new Error('sender not found'), { name: 'CreateTransferError' }),
      Object.assign(new Error('sender not initialized'), { name: 'CreateTransferError' }),
    ]
    for (const err of cases) {
      buildTopUpTransaction.mockRejectedValueOnce(err)
      await expect(handler(evt({ amount: '5' })), err.name).rejects.toMatchObject({ statusCode: 402, data: { code: 'insufficient_funds' } })
    }
  })
})
