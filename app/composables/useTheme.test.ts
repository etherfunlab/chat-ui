import { describe, it, expect } from 'vitest'
import { resolveTheme } from './useTheme'

describe('resolveTheme', () => {
  it('follows the system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('an explicit preference wins over the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})
