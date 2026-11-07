import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, parseBearer } from './apiKeys'

describe('generateApiKey', () => {
  it('produces a cu- prefixed 46-character key, fresh each time', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).toMatch(/^cu-[A-Za-z0-9_-]{43}$/)
    expect(a.key).toHaveLength(46)
    expect(a.key).not.toBe(b.key)
  })

  it('returns the sha256 hash and the display prefix of the key', () => {
    const k = generateApiKey()
    expect(k.hash).toBe(hashApiKey(k.key))
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(k.prefix).toBe(k.key.slice(0, 10))
  })
})

describe('parseBearer', () => {
  const key = `cu-${'a'.repeat(43)}`

  it('accepts a Bearer key, scheme case-insensitively', () => {
    expect(parseBearer(`Bearer ${key}`)).toBe(key)
    expect(parseBearer(`bearer ${key}`)).toBe(key)
  })

  it('rejects a missing header, another scheme, or a malformed key', () => {
    expect(parseBearer(undefined)).toBeNull()
    expect(parseBearer('')).toBeNull()
    expect(parseBearer(`Basic ${key}`)).toBeNull()
    expect(parseBearer(`Bearer sk-${'a'.repeat(43)}`)).toBeNull()
    expect(parseBearer(`Bearer cu-${'a'.repeat(42)}`)).toBeNull()
    expect(parseBearer(`Bearer ${key} extra`)).toBeNull()
  })
})
