/**
 * A per-answer charge: below $1 it shows up to four decimals (truncated,
 * trailing zeros dropped) so cents-fractions stay visible; from $1 it is
 * formatUsd.
 */
export function formatCost(micro: string | number): string {
  const value = BigInt(micro)
  if (value === 0n) return '$0'
  if (value < 100n) return '<$0.0001'
  if (value >= 1_000_000n) return formatUsd(micro)
  const tenThousandths = (value / 100n).toString().padStart(4, '0')
  return `$0.${tenThousandths.replace(/0+$/, '')}`
}

/** Formats micro-USD as dollars, truncated toward zero to whole cents. Exact (BigInt). */
export function formatUsd(micro: string | number): string {
  const value = BigInt(micro)
  const cents = (value < 0n ? -value : value) / 10_000n
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const rest = (cents % 100n).toString().padStart(2, '0')
  const sign = value < 0n && cents > 0n ? '-' : ''
  return `${sign}$${dollars}.${rest}`
}
