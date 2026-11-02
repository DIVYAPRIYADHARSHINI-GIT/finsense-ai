/**
 * Civil-date helpers.
 *
 * Dates are `YYYY-MM-DD` strings throughout. When a Date object is unavoidable
 * (formatting, day-of-week) we anchor at local noon so that DST shifts and
 * UTC-offset arithmetic can never move a transaction to the previous day.
 */

import type { Settings } from './types'

export function todayISO(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse `YYYY-MM-DD` to a local-noon Date. Returns null for invalid input. */
export function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0)
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
  return dt
}

export function isValidISO(iso: string): boolean {
  return parseISO(iso) !== null
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return toISO(d)
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso)
  if (!d) return iso
  const targetMonth = d.getMonth() + months
  const anchor = new Date(d.getFullYear(), targetMonth, 1, 12)
  const lastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
  anchor.setDate(Math.min(d.getDate(), lastDay))
  return toISO(anchor)
}

/** `YYYY-MM` month key. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function monthLabel(key: string): string {
  const d = parseISO(`${key}-01`)
  if (!d) return key
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** ISO week key `YYYY-Www`, Monday-based. */
export function weekKey(iso: string): string {
  const d = parseISO(iso)
  if (!d) return iso
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  const dayNum = (tmp.getDay() + 6) % 7
  tmp.setDate(tmp.getDate() - dayNum + 3)
  const firstThursday = new Date(tmp.getFullYear(), 0, 4, 12)
  const diff = tmp.getTime() - firstThursday.getTime()
  const week = 1 + Math.round(diff / (7 * 86400000))
  return `${tmp.getFullYear()}-W${`${week}`.padStart(2, '0')}`
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string, format: Settings['dateFormat']): string {
  const d = parseISO(iso)
  if (!d) return iso
  const dd = `${d.getDate()}`.padStart(2, '0')
  const mm = `${d.getMonth() + 1}`.padStart(2, '0')
  const yyyy = d.getFullYear()
  switch (format) {
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${yyyy}`
    case 'MM/dd/yyyy':
      return `${mm}/${dd}/${yyyy}`
    case 'yyyy-MM-dd':
      return iso
    case 'dd MMM yyyy':
    default:
      return `${dd} ${MONTH_SHORT[d.getMonth()]} ${yyyy}`
  }
}

/** Inclusive month keys between two ISO dates. */
export function monthRange(fromISO: string, toISOStr: string): string[] {
  const out: string[] = []
  let cursor = `${monthKey(fromISO)}-01`
  const end = monthKey(toISOStr)
  let guard = 0
  while (monthKey(cursor) <= end && guard++ < 600) {
    out.push(monthKey(cursor))
    cursor = addMonths(cursor, 1)
  }
  return out
}
