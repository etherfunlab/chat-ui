// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import fixture from '../../../server/utils/__fixtures__/venice-models.json'
import { toModelEntry } from '../../../server/utils/catalog'
import type { ModelEntry } from '#shared/models'

vi.stubGlobal('useI18n', () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }))
const { default: ThinkingMenu } = await import('./ThinkingMenu.vue')

const model = (id: string) => toModelEntry(fixture.data.find(m => m.id === id))! as ModelEntry
const OPUS = model('claude-opus-5-5')
const DEEPSEEK = model('deepseek-v4-1-flash-1017-uncensored')
const GEMINI = model('gemini-4-argon')

async function openMenu(m: ModelEntry, value = { enabled: true, effort: m.reasoning.defaultEffort }) {
  const w = mount(ThinkingMenu, { props: { model: m, modelValue: value } })
  await w.get('button[data-role="thinking-chip"]').trigger('click')
  return w
}

const items = (w: Awaited<ReturnType<typeof openMenu>>) => w.findAll('[role="menuitemradio"]').map(i => i.text())

describe('ThinkingMenu', () => {
  it('offers Opus only its effort levels, with no Off', async () => {
    const w = await openMenu(OPUS)
    expect(items(w)).toEqual(['effort.low', 'effort.medium', 'effort.high', 'effort.xhigh', 'effort.max'])
  })

  it('offers Off first for a model that can disable thinking', async () => {
    const w = await openMenu(DEEPSEEK)
    expect(items(w)).toEqual(['effort.off', 'effort.low', 'effort.high', 'effort.max'])
  })

  it('emits a disabled preference when Off is chosen', async () => {
    const w = await openMenu(DEEPSEEK)
    await w.findAll('[role="menuitemradio"]')[0]!.trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual([{ enabled: false, effort: 'high' }])
  })

  it('emits the chosen effort with thinking on', async () => {
    const w = await openMenu(DEEPSEEK, { enabled: false, effort: 'high' })
    await w.findAll('[role="menuitemradio"]')[1]!.trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual([{ enabled: true, effort: 'low' }])
  })

  it('shows no effort control for a model without one', () => {
    const w = mount(ThinkingMenu, { props: { model: GEMINI, modelValue: { enabled: true, effort: null } } })
    expect(w.find('button[data-role="thinking-chip"]').exists()).toBe(false)
    expect(w.text()).toContain('chat.thinkingOn')
  })
})
