import nacl from 'tweetnacl'
import bs58 from 'bs58'

/**
 * Sign-In-With-Solana message. The format is frozen: the server rebuilds the
 * exact string from its own nonce record to verify the signature, so any
 * change here invalidates in-flight sign-ins.
 */
export function buildSignInMessage(p: {
  domain: string
  address: string
  nonce: string
  issuedAt: string
}): string {
  return `${p.domain} wants you to sign in with your Solana account:\n${p.address}\n\nNonce: ${p.nonce}\nIssued At: ${p.issuedAt}`
}

export function verifySignInSignature(p: {
  message: string
  signatureB58: string
  address: string
}): boolean {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(p.message),
      bs58.decode(p.signatureB58),
      bs58.decode(p.address),
    )
  } catch {
    return false
  }
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    return bs58.decode(address).length === 32
  } catch {
    return false
  }
}
