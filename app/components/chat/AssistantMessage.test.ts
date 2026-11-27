// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import type { StoredMessage } from '~/lib/store'

vi.stubGlobal('useI18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }))
const { default: AssistantMessage } = await import('./AssistantMessage.vue')

enableAutoUnmount(afterEach)

const message = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 'a1', sessionId: 's', role: 'assistant', text: '', images: [], reasoning: '', reasoningMs: null,
  thinkingRequested: false, citations: [], usage: null, status: 'done', error: null, omittedImages: 0,
  model: 'claude-opus-5-5', createdAt: 0, ...over,
})
const show = (m: StoredMessage) => mount(AssistantMessage, { props: { message: m } })
const has = (w: VueWrapper, sel: string) => w.find(sel).exists()
const WINDOW = '[data-part="window"]'
const PILL = '[data-part="pill"]'

describe('AssistantMessage: thinking', () => {
  it('shows the window from the moment a thinking request is sent, and no waiting line', () => {
    const w = show(message({ status: 'streaming', thinkingRequested: true }))
    expect(has(w, WINDOW)).toBe(true)
    expect(w.text()).toContain('chat.thinking')
    expect(w.text()).not.toContain('chat.waiting')
  })

  it('shows the waiting line, and no window, when thinking was not requested', () => {
    const w = show(message({ status: 'streaming', thinkingRequested: false }))
    expect(has(w, WINDOW)).toBe(false)
    expect(w.text()).toContain('chat.waiting')
  })

  it('hands over to the window when thinking text arrives on a request that did not ask for it', () => {
    const w = show(message({ status: 'streaming', thinkingRequested: false, reasoning: 'hm' }))
    expect(w.get('[data-part="window-text"]').text()).toBe('hm')
    expect(w.text()).not.toContain('chat.waiting')
  })

  it('turns the window into the pill as soon as answer text arrives', async () => {
    const w = show(message({ status: 'streaming', thinkingRequested: true, reasoning: 'hm' }))
    await w.setProps({ message: message({ status: 'streaming', thinkingRequested: true, reasoning: 'hm', reasoningMs: 4200, text: 'Hi' }) })
    expect(has(w, WINDOW)).toBe(false)
    expect(w.get(PILL).text()).toBe('chat.thoughtFor:{"n":4}')
    expect(w.text()).toContain('Hi')
  })

  it('shows neither window nor pill when the model answered without thinking', async () => {
    const w = show(message({ status: 'streaming', thinkingRequested: true }))
    await w.setProps({ message: message({ status: 'streaming', thinkingRequested: true, text: 'Hi' }) })
    expect(has(w, WINDOW)).toBe(false)
    expect(has(w, PILL)).toBe(false)
    expect(has(w, '[role="status"]')).toBe(false)
  })

  it.each(['aborted', 'error'] as const)('leaves the pill when thinking ends %s before any answer text', (status) => {
    const w = show(message({ status, thinkingRequested: true, reasoning: 'hm', reasoningMs: 2000, error: status === 'error' ? 'boom' : null }))
    expect(has(w, WINDOW)).toBe(false)
    expect(has(w, PILL)).toBe(true)
    if (status === 'error') expect(w.text()).toContain('boom')
  })

  it('shows the pill on an old message that has no thinkingRequested field', () => {
    const old: Partial<StoredMessage> = message({ reasoning: 'hm', reasoningMs: 9000, text: 'Hi' })
    delete old.thinkingRequested
    const w = show(old as StoredMessage)
    expect(w.get(PILL).text()).toBe('chat.thoughtFor:{"n":9}')
  })

  it('opens the full thinking text from the pill', async () => {
    const w = show(message({ reasoning: 'She keeps a lighthouse.', reasoningMs: 4200, text: 'Hi' }))
    await w.get(PILL).trigger('click')
    expect(w.get('[data-part="pill-text"]').text()).toBe('She keeps a lighthouse.')
  })

  it('passes the running clock wording through i18n', async () => {
    vi.useFakeTimers()
    const w = show(message({ status: 'streaming', thinkingRequested: true }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.get('[data-part="elapsed"]').text()).toBe('chat.thinkingElapsed:{"n":3}')
    w.unmount()
    vi.useRealTimers()
  })
})
