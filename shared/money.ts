/** Formats micro-USD as dollars, truncated toward zero to whole cents. Exact (BigInt). */
export function formatUsd(micro: string | number): string {
  const value = BigInt(micro)
  const cents = (value < 0n ? -value : value) / 10_000n
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const rest = (cents % 100n).toString().padStart(2, '0')
  const sign = value < 0n && cents > 0n ? '-' : ''
  return `${sign}$${dollars}.${rest}`
}
