// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.stubGlobal('useI18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }))
const { default: ThinkingBlock } = await import('./ThinkingBlock.vue')

describe('ThinkingBlock', () => {
  it('is open while streaming', () => {
    const w = mount(ThinkingBlock, { props: { reasoning: 'weighing options', streaming: true, ms: null } })
    expect(w.text()).toContain('chat.thinking')
    expect(w.text()).toContain('weighing options')
  })

  it('collapses to a one-line summary when done, and opens on click', async () => {
    const w = mount(ThinkingBlock, { props: { reasoning: 'weighing options', streaming: false, ms: 12_400 } })
    expect(w.text()).toContain('chat.thoughtFor:{"s":12}')
    expect(w.text()).not.toContain('weighing options')
    await w.get('button').trigger('click')
    expect(w.text()).toContain('weighing options')
  })

  it('collapses when streaming ends', async () => {
    const w = mount(ThinkingBlock, { props: { reasoning: 'r', streaming: true, ms: null } })
    await w.setProps({ streaming: false, ms: 900 })
    expect(w.text()).toContain('chat.thoughtFor:{"s":1}')
    expect(w.text()).not.toContain('chat.thinking')
  })
})
