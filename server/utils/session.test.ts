import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionData: { wallet?: string } = {}
const capturedOptions: Record<string, unknown>[] = []
vi.stubGlobal('useSession', async (_event: unknown, options: Record<string, unknown>) => {
  capturedOptions.push(options)
  return { data: sessionData, update: vi.fn(), clear: vi.fn() }
})
vi.stubGlobal('createError', (e: Record<string, unknown>) => Object.assign(new Error(String(e.statusMessage)), e))

const { getSessionWallet } = await import('./session')
const evt = {} as never

beforeEach(() => {
  vi.stubEnv('BILLING', '')
  vi.stubEnv('ALLOWED_WALLETS', '')
  vi.stubEnv('DATABASE_URL', 'postgres://x')
  vi.stubEnv('SESSION_SECRET', 's'.repeat(32))
  vi.stubEnv('VENICE_API_KEY', 'vk')
  delete sessionData.wallet
})

describe('getSessionWallet', () => {
  it('returns the session wallet when billing is on', async () => {
    sessionData.wallet = 'W1'
    expect(await getSessionWallet(evt)).toBe('W1')
  })

  it('re-checks the whitelist on every use when BILLING=off', async () => {
    vi.stubEnv('BILLING', 'off')
    vi.stubEnv('ALLOWED_WALLETS', 'OTHER')
    sessionData.wallet = 'W1'
    expect(await getSessionWallet(evt)).toBeNull()
  })

  it('accepts a whitelisted wallet when BILLING=off', async () => {
    vi.stubEnv('BILLING', 'off')
    vi.stubEnv('ALLOWED_WALLETS', 'W1')
    sessionData.wallet = 'W1'
    expect(await getSessionWallet(evt)).toBe('W1')
  })

  it('accepts the session only from the cookie, never a header', async () => {
    sessionData.wallet = 'W1'
    await getSessionWallet(evt)
    expect(capturedOptions.at(-1)).toMatchObject({ sessionHeader: false })
  })
})
