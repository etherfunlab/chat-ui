import { describe, it, expect } from 'vitest'
import { formatCost, formatUsd } from './money'

describe('formatCost', () => {
  it('shows small per-answer charges to a tenth of a cent, truncated', () => {
    expect(formatCost('6524')).toBe('$0.0065')
    expect(formatCost('51000')).toBe('$0.051')
    expect(formatCost('1230000')).toBe('$1.23')
    expect(formatCost('0')).toBe('$0')
    expect(formatCost('40')).toBe('<$0.0001')
  })
})

describe('formatUsd', () => {
  it('formats micro-USD as dollars, truncated to cents', () => {
    expect(formatUsd('1234567')).toBe('$1.23')
    expect(formatUsd(1_000_000)).toBe('$1.00')
    expect(formatUsd('9999')).toBe('$0.00')
    expect(formatUsd('0')).toBe('$0.00')
    expect(formatUsd('123456789012')).toBe('$123,456.78')
  })

  it('signs negatives and never prints negative zero', () => {
    expect(formatUsd('-1234567')).toBe('-$1.23')
    expect(formatUsd('-50')).toBe('$0.00')
  })

  it('stays exact beyond float precision', () => {
    expect(formatUsd('9007199254740993000')).toBe('$9,007,199,254,740.99')
  })
})
