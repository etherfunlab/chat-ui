// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.stubGlobal('useI18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }))
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)
const { default: ApiKeysPanel } = await import('./ApiKeysPanel.vue')

const rows = [
  { id: 'k1', name: 'laptop', prefix: 'cu-aaaaaaa', createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: '2026-11-07T00:00:00.000Z', revokedAt: null },
  { id: 'k0', name: 'old', prefix: 'cu-bbbbbbb', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-10-15T00:00:00.000Z' },
]

async function mountPanel() {
  const w = mount(ApiKeysPanel)
  await flushPromises()
  return w
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, opts?: { method?: string }) => {
    if (url === '/api/keys' && (!opts?.method || opts.method === 'GET')) return { keys: rows }
    if (url === '/api/keys' && opts?.method === 'POST') return { key: 'cu-plaintext-once', row: rows[0] }
    if (url.startsWith('/api/keys/') && opts?.method === 'DELETE') return { revoked: true }
    throw new Error(`unexpected ${url}`)
  })
})

describe('ApiKeysPanel', () => {
  it('lists keys on mount; revoked keys have no revoke button', async () => {
    const w = await mountPanel()
    expect(fetchMock).toHaveBeenCalledWith('/api/keys')
    const items = w.findAll('[data-role="key-row"]')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('laptop')
    expect(items[0]!.text()).toContain('cu-aaaaaaa')
    expect(items[0]!.find('[data-role="revoke-key"]').exists()).toBe(true)
    expect(items[1]!.text()).toContain('settings.keyRevoked')
    expect(items[1]!.find('[data-role="revoke-key"]').exists()).toBe(false)
    expect(w.text()).toContain('/v1')
  })

  it('creates a key, shows the plaintext once and refreshes the list', async () => {
    const w = await mountPanel()
    await w.get('[data-role="key-name"]').setValue('laptop')
    await w.get('[data-role="create-key"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/keys', { method: 'POST', body: { name: 'laptop' } })
    expect(w.get('[data-role="new-key"]').text()).toContain('cu-plaintext-once')
    expect(w.text()).toContain('settings.keyShownOnce')
    expect(fetchMock.mock.calls.filter(c => c[0] === '/api/keys' && !c[1]?.method)).toHaveLength(2)
    expect((w.get('[data-role="key-name"]').element as HTMLInputElement).value).toBe('')
  })

  it('survives a clipboard that refuses to write', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const w = await mountPanel()
    await w.get('[data-role="key-name"]').setValue('laptop')
    await w.get('[data-role="create-key"]').trigger('click')
    await flushPromises()
    await w.get('[data-role="copy-key"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-role="copy-key"]').text()).toBe('chat.copy')
    expect(w.get('[data-role="new-key"]').text()).toContain('cu-plaintext-once')
  })

  it('does not create a key without a name', async () => {
    const w = await mountPanel()
    await w.get('[data-role="create-key"]').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false)
  })

  it('revokes a key and refreshes', async () => {
    const w = await mountPanel()
    await w.get('[data-role="revoke-key"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/keys/k1', { method: 'DELETE' })
    expect(fetchMock.mock.calls.filter(c => c[0] === '/api/keys' && !c[1]?.method)).toHaveLength(2)
  })

  it('maps server error codes to copy', async () => {
    fetchMock.mockImplementationOnce(async () => ({ keys: rows }))
    fetchMock.mockImplementationOnce(async () => { throw { data: { statusMessage: 'too_many_keys' } } })
    const w = await mountPanel()
    await w.get('[data-role="key-name"]').setValue('x')
    await w.get('[data-role="create-key"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('settings.tooManyKeys')
    expect(w.find('[data-role="new-key"]').exists()).toBe(false)
  })
})
