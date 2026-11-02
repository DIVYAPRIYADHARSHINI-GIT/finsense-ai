/**
 * Integer-paise money helpers and locale formatting.
 *
 * Every rupee figure in the app funnels through here. `toPaise` is the only
 * place a float becomes money, and it rounds once, so a 1,234.565 CSV cell
 * cannot drift as it is summed 500 times.
 */

import { CURRENCY_META, type Settings } from './types'

export function toPaise(major: number | string): number {
  const n = typeof major === 'string' ? Number(major.replace(/[,\s\u20B9$]/g, '')) : major
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export function toMajor(paise: number): number {
  return paise / 100
}

export function formatMoney(
  paise: number,
  currency: Settings['currency'] = 'INR',
  opts: { compact?: boolean; signed?: boolean } = {},
): string {
  const meta = CURRENCY_META[currency]
  const value = toMajor(paise)
  const fmt = new Intl.NumberFormat(meta.locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : 2,
    notation: opts.compact ? 'compact' : 'standard',
  })
  const out = fmt.format(Math.abs(value))
  if (opts.signed && paise !== 0) return `${paise > 0 ? '+' : '-'}${out}`
  return value < 0 ? `-${out}` : out
}

export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '--'
  return `${(ratio * 100).toFixed(digits)}%`
}

/** Indian-style grouping for plain counts (12,34,567). */
export function formatCount(n: number, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale).format(n)
}
