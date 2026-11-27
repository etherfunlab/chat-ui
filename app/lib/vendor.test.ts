// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { ThinkingBlock, type ThinkingLabels } from '@etherfunlab/vue-llm-ui'

const labels: ThinkingLabels = { thinking: 'Thinking', elapsed: n => `${n}s`, done: n => `Thought for ${n}s` }

describe('vendored thinking components', () => {
  it('resolve through the package name and render', () => {
    const w = mount(ThinkingBlock, { props: { text: 'hm', active: false, ms: 4200, labels } })
    expect(w.get('[data-part="pill"]').text()).toBe('Thought for 4s')
  })
})
