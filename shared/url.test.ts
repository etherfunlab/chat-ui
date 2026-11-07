import { describe, it, expect } from 'vitest'
import { safeHttpUrl } from './url'

describe('safeHttpUrl', () => {
  it('keeps http and https URLs', () => {
    expect(safeHttpUrl('https://solana.com/docs')).toBe('https://solana.com/docs')
    expect(safeHttpUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
  })

  it('rejects every other scheme and relative or malformed input', () => {
    for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', 'not a url', '']) {
      expect(safeHttpUrl(bad), bad).toBeNull()
    }
    expect(safeHttpUrl(42)).toBeNull()
  })
})
