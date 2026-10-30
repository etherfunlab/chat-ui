// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import fixture from '../../../server/utils/__fixtures__/venice-models.json'
import { toModelEntry } from '../../../server/utils/catalog'
import type { ModelEntry } from '#shared/models'

vi.stubGlobal('useI18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }))
vi.mock('~/lib/images', () => ({ downscaleImage: vi.fn(async () => 'data:image/jpeg;base64,AA') }))
const { default: Composer } = await import('./Composer.vue')

const OPUS = toModelEntry(fixture.data.find(m => m.id === 'claude-opus-5-5'))! as ModelEntry
const TEXT_ONLY: ModelEntry = { ...OPUS, vision: false, maxImages: 0 }

const mountComposer = (props: Record<string, unknown> = {}) => mount(Composer, {
  props: { model: OPUS, thinking: { enabled: true, effort: 'high' }, webSearch: false, sending: false, ...props },
})

describe('Composer', () => {
  it('disables the image chip for a model without vision', () => {
    expect(mountComposer({ model: TEXT_ONLY }).get('button[data-role="image-chip"]').attributes('disabled')).toBeDefined()
    expect(mountComposer().get('button[data-role="image-chip"]').attributes('disabled')).toBeUndefined()
  })

  it('sends on Enter and clears the input', async () => {
    const w = mountComposer()
    const ta = w.get('textarea')
    await ta.setValue('hello')
    await ta.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')![0]).toEqual([{ text: 'hello', images: [] }])
    expect((ta.element as HTMLTextAreaElement).value).toBe('')
  })

  it('does not send on Shift+Enter or during IME composition', async () => {
    const w = mountComposer()
    const ta = w.get('textarea')
    await ta.setValue('line one')
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
    await ta.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(w.emitted('send')).toBeUndefined()
  })

  it('does not send an empty message', async () => {
    const w = mountComposer()
    await w.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('send')).toBeUndefined()
  })

  it('shows Stop while sending and emits stop', async () => {
    const w = mountComposer({ sending: true })
    const button = w.get('button[data-role="send"]')
    expect(button.text()).toContain('chat.stop')
    await button.trigger('click')
    expect(w.emitted('stop')).toHaveLength(1)
  })

  it('toggles web search', async () => {
    const w = mountComposer()
    await w.get('button[data-role="web-chip"]').trigger('click')
    expect(w.emitted('update:webSearch')![0]).toEqual([true])
  })
})
