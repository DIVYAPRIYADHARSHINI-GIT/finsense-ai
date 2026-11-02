/**
 * CSV -> Transaction conversion with row-level diagnostics.
 *
 * Nothing is discarded silently: every input row leaves this module as either
 * `rows` (importable), `skipped` (duplicate / blank) or `failed` (with a
 * human-readable reason naming the offending column).
 */

import { CATEGORIES, PAYMENT_METHODS, type Category, type PaymentMethod, type Transaction, type TxnType } from './types'
import { isValidISO, toISO } from './dates'
import { toPaise } from './money'
import type { FieldKey } from './csv'

export interface ParsedRow {
  rowNumber: number
  txn: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>
  warnings: string[]
}

export interface FailedRow {
  rowNumber: number
  raw: string[]
  errors: string[]
}

export interface SkippedRow {
  rowNumber: number
  raw: string[]
  reason: string
}

export interface ImportResult {
  rows: ParsedRow[]
  failed: FailedRow[]
  skipped: SkippedRow[]
  total: number
}

/**
 * Parse a date cell from any of the formats Indian banks actually emit.
 * `dayFirst` resolves the genuinely ambiguous 03/04/2024 case; the caller
 * decides it once for the whole file (see `inferDayFirst`).
 */
export function parseDateCell(value: string, dayFirst = true): string | null {
  const s = (value ?? '').trim()
  if (!s) return null

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return normalise(Number(m[1]), Number(m[2]), Number(m[3]))

  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    let y = Number(m[3])
    if (y < 100) y += y < 70 ? 2000 : 1900
    // A value > 12 can only be the day, whatever the file claims.
    if (a > 12) return normalise(y, b, a)
    if (b > 12) return normalise(y, a, b)
    return dayFirst ? normalise(y, b, a) : normalise(y, a, b)
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  m = /^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{2,4})/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    let y = Number(m[3])
    if (y < 100) y += 2000
    if (mi >= 0) return normalise(y, mi + 1, Number(m[1]))
  }
  m = /^([A-Za-z]{3,})[\s-]*(\d{1,2}),?[\s-]*(\d{2,4})/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    let y = Number(m[3])
    if (y < 100) y += 2000
    if (mi >= 0) return normalise(y, mi + 1, Number(m[2]))
  }

  const parsed = new Date(s)
  if (!Number.isNaN(parsed.getTime())) return toISO(parsed)
  return null

  function normalise(y: number, mo: number, d: number): string | null {
    const iso = `${y}-${`${mo}`.padStart(2, '0')}-${`${d}`.padStart(2, '0')}`
    return isValidISO(iso) ? iso : null
  }
}

/** Scan the date column: if any cell has first-part > 12, the file is day-first. */
export function inferDayFirst(cells: string[]): boolean {
  let dayFirstEvidence = 0
  let monthFirstEvidence = 0
  for (const c of cells) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec((c ?? '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) dayFirstEvidence++
    if (Number(m[2]) > 12) monthFirstEvidence++
  }
  if (dayFirstEvidence && !monthFirstEvidence) return true
  if (monthFirstEvidence && !dayFirstEvidence) return false
  return true // Indian bank statements default to dd/MM
}

export function parseAmountCell(value: string): number | null {
  let s = (value ?? '').trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true // accounting negative
    s = s.slice(1, -1)
  }
  if (/(^|\s)(dr|debit)\b/i.test(s)) negative = true
  s = s.replace(/[^\d.,\-]/g, '')
  if (!s) return null
  // European decimal comma: 1.234,56
  if (/,\d{1,2}$/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

function normaliseCategory(v: string): Category | null {
  const s = (v ?? '').trim().toLowerCase()
  if (!s) return null
  const hit = CATEGORIES.find((c) => c.toLowerCase() === s)
  if (hit) return hit
  const loose = CATEGORIES.find((c) => c.toLowerCase().replace(/[^a-z]/g, '') === s.replace(/[^a-z]/g, ''))
  return loose ?? null
}

function normalisePayment(v: string): PaymentMethod | null {
  const s = (v ?? '').trim().toLowerCase()
  if (!s) return null
  const hit = PAYMENT_METHODS.find((p) => p.toLowerCase() === s)
  if (hit) return hit
  if (/upi|gpay|phonepe|paytm|bhim/.test(s)) return 'UPI'
  if (/credit/.test(s)) return 'Credit Card'
  if (/debit|atm/.test(s)) return 'Debit Card'
  if (/net\s*bank|imps|neft|rtgs/.test(s)) return 'Net Banking'
  if (/cash/.test(s)) return 'Cash'
  if (/auto|mandate|ecs|si\b/.test(s)) return 'Auto Debit'
  if (/wallet/.test(s)) return 'Wallet'
  return null
}

/** Stable key for duplicate detection: same day + same amount + same narration. */
export function dedupeKey(t: { date: string; amountPaise: number; description: string; merchant: string }): string {
  const text = `${t.merchant} ${t.description}`.toLowerCase().replace(/\s+/g, ' ').trim()
  return `${t.date}|${t.amountPaise}|${text}`
}

export interface MapCSVOptions {
  mapping: Record<number, FieldKey>
  hasHeader: boolean
  existingKeys?: Set<string>
  defaultPaymentMethod?: PaymentMethod
  dayFirst?: boolean
}

export function mapRowsToTransactions(rows: string[][], options: MapCSVOptions): ImportResult {
  const { mapping, hasHeader, existingKeys = new Set<string>() } = options
  const body = hasHeader ? rows.slice(1) : rows
  const offset = hasHeader ? 2 : 1

  const colOf = (key: FieldKey): number => Number(Object.keys(mapping).find((k) => mapping[Number(k)] === key) ?? -1)
  const dateCol = colOf('date')
  const dayFirst =
    options.dayFirst ?? inferDayFirst(dateCol >= 0 ? body.map((r) => r[dateCol] ?? '') : [])

  const result: ImportResult = { rows: [], failed: [], skipped: [], total: body.length }
  const seenInFile = new Set<string>()

  body.forEach((raw, i) => {
    const rowNumber = i + offset
    const errors: string[] = []
    const warnings: string[] = []
    const get = (key: FieldKey): string => {
      const c = colOf(key)
      return c >= 0 ? (raw[c] ?? '').trim() : ''
    }

    if (raw.every((c) => (c ?? '').trim() === '')) {
      result.skipped.push({ rowNumber, raw, reason: 'Blank row' })
      return
    }

    const dateRaw = get('date')
    const date = parseDateCell(dateRaw, dayFirst)
    if (!date) errors.push(dateRaw ? `Unrecognised date "${dateRaw}"` : 'Missing transaction date')

    // Amount can arrive as one signed column, or as separate debit/credit columns.
    const amountRaw = get('amount')
    const debitRaw = get('debit')
    const creditRaw = get('credit')
    let major: number | null = null
    let type: TxnType | null = null

    const debit = parseAmountCell(debitRaw)
    const credit = parseAmountCell(creditRaw)
    if (debit !== null && Math.abs(debit) > 0) {
      major = Math.abs(debit)
      type = 'expense'
    } else if (credit !== null && Math.abs(credit) > 0) {
      major = Math.abs(credit)
      type = 'income'
    } else {
      const amt = parseAmountCell(amountRaw)
      if (amt === null) {
        errors.push(
          amountRaw || debitRaw || creditRaw
            ? `Unrecognised amount "${amountRaw || debitRaw || creditRaw}"`
            : 'Missing amount',
        )
      } else if (amt === 0) {
        errors.push('Amount is zero')
      } else {
        major = Math.abs(amt)
        type = amt < 0 ? 'expense' : null
      }
    }

    const typeRaw = get('type').toLowerCase()
    if (typeRaw) {
      if (/credit|income|cr\b|deposit|in\b|received/.test(typeRaw)) type = 'income'
      else if (/debit|expense|dr\b|withdraw|out\b|paid|spent/.test(typeRaw)) type = 'expense'
    }
    if (type === null) {
      type = 'expense'
      if (major !== null) warnings.push('Direction not stated in file; assumed Expense')
    }

    const description = get('description')
    let merchant = get('merchant')
    if (!merchant && description) {
      // Pull the longest alphabetic token out of a UPI narration as the merchant.
      const token = description
        .split(/[/|,\-]+/)
        .map((t) => t.trim())
        .filter((t) => /[A-Za-z\u0B80-\u0BFF\u0900-\u097F]{3,}/.test(t) && !/^upi$/i.test(t))
        .sort((a, b) => b.length - a.length)[0]
      if (token) {
        merchant = token.slice(0, 60)
        warnings.push('Merchant inferred from description')
      }
    }
    if (!description && !merchant) warnings.push('No description or merchant; category prediction will be uncertain')

    if (errors.length) {
      result.failed.push({ rowNumber, raw, errors })
      return
    }

    const category = normaliseCategory(get('category'))
    const paymentMethod = normalisePayment(get('paymentMethod')) ?? options.defaultPaymentMethod ?? 'UPI'
    const amountPaise = toPaise(major as number)

    const txn: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      date: date as string,
      description,
      merchant,
      amountPaise,
      type: type as TxnType,
      category: category ?? (type === 'income' ? 'Salary' : 'Other'),
      paymentMethod,
      notes: get('notes'),
      categorySource: category ? 'import' : 'ml',
    }

    const key = dedupeKey(txn)
    if (existingKeys.has(key)) {
      result.skipped.push({ rowNumber, raw, reason: 'Duplicate of a transaction already stored' })
      return
    }
    if (seenInFile.has(key)) {
      result.skipped.push({ rowNumber, raw, reason: 'Duplicate row within this file' })
      return
    }
    seenInFile.add(key)

    if (!category) warnings.push('Category will be predicted by the ML model')
    result.rows.push({ rowNumber, txn, warnings })
  })

  return result
}

export const SAMPLE_CSV_HEADERS = [
  'Date',
  'Description',
  'Merchant',
  'Debit',
  'Credit',
  'Category',
  'Payment Method',
  'Notes',
]

/** The downloadable template, deliberately including a Tamil and a Hindi row. */
export const SAMPLE_CSV_ROWS: (string | number)[][] = [
  ['2025-04-01', 'UPI/DR/402938471/FreshCart Supermarket', 'FreshCart Supermarket', '2480.50', '', 'Groceries', 'UPI', 'Weekly groceries'],
  ['2025-04-02', 'SALARY CREDIT NORTHWIND STUDIO', 'Northwind Studio', '', '92000.00', 'Salary', 'Net Banking', 'April salary'],
  ['2025-04-03', 'UPI/DR/402944120/\u0B85\u0BA3\u0BCD\u0BA3\u0BBE \u0BAE\u0BC6\u0BB8\u0BCD', '\u0B85\u0BA3\u0BCD\u0BA3\u0BBE \u0BAE\u0BC6\u0BB8\u0BCD', '320.00', '', 'Food & Dining', 'UPI', 'Lunch'],
  ['2025-04-05', 'NACH/RENT/GREENLEAF PROPERTIES', 'Greenleaf Properties', '24000.00', '', 'Rent', 'Auto Debit', 'Monthly rent'],
  ['2025-04-07', 'UPI/DR/403001882/\u091A\u093E\u092F \u0915\u0940 \u0926\u0941\u0915\u093E\u0928', '\u091A\u093E\u092F \u0915\u0940 \u0926\u0941\u0915\u093E\u0928', '60.00', '', '', 'Cash', ''],
  ['2025-04-09', 'StreamNest Monthly Plan, auto-renew', 'StreamNest', '499.00', '', 'Subscriptions', 'Credit Card', 'Streaming'],
]
