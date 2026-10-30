import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { buildSignInMessage, verifySignInSignature, isValidSolanaAddress } from './siws'

function keypair() {
  const kp = nacl.sign.keyPair()
  return { address: bs58.encode(kp.publicKey), secretKey: kp.secretKey }
}

function sign(message: string, secretKey: Uint8Array): string {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secretKey))
}

describe('buildSignInMessage', () => {
  it('builds the frozen message format', () => {
    expect(buildSignInMessage({ domain: 'chat.example.com', address: 'Addr', nonce: 'N', issuedAt: 'T' }))
      .toBe('chat.example.com wants you to sign in with your Solana account:\nAddr\n\nNonce: N\nIssued At: T')
  })
})

describe('verifySignInSignature', () => {
  const msg = buildSignInMessage({ domain: 'd', address: 'a', nonce: 'n', issuedAt: 't' })

  it('accepts a signature from the address keypair', () => {
    const { address, secretKey } = keypair()
    expect(verifySignInSignature({ message: msg, signatureB58: sign(msg, secretKey), address })).toBe(true)
  })

  it('rejects a signature from another keypair', () => {
    const { address } = keypair()
    const other = keypair()
    expect(verifySignInSignature({ message: msg, signatureB58: sign(msg, other.secretKey), address })).toBe(false)
  })

  it('rejects a tampered message', () => {
    const { address, secretKey } = keypair()
    expect(verifySignInSignature({ message: msg + 'x', signatureB58: sign(msg, secretKey), address })).toBe(false)
  })

  it('returns false on undecodable input instead of throwing', () => {
    const { address } = keypair()
    expect(verifySignInSignature({ message: msg, signatureB58: 'not-base58-0OIl', address })).toBe(false)
    expect(verifySignInSignature({ message: msg, signatureB58: 'abc', address: 'not-base58-0OIl' })).toBe(false)
  })
})

describe('isValidSolanaAddress', () => {
  it('validates solana addresses', () => {
    const { address } = keypair()
    expect(isValidSolanaAddress(address)).toBe(true)
    expect(isValidSolanaAddress('abc')).toBe(false)
    expect(isValidSolanaAddress(bs58.encode(new Uint8Array(31)))).toBe(false)
    expect(isValidSolanaAddress('not-base58-0OIl')).toBe(false)
  })
})
