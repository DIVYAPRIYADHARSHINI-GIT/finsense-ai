/**
 * Recurring payment / subscription detection.
 *
 * Deterministic signal processing rather than ML, because the signal is a
 * periodicity in exact dates and amounts - a statistical model would be less
 * accurate and far less explainable here.
 *
 * Algorithm per merchant group:
 *  1. require >= 3 charges
 *  2. compute the gaps between consecutive charges
 *  3. take the median gap and snap it to a known cadence (7/30/91/365 days)
 *  4. score regularity from gap variance + amount variance
 *  5. keep groups whose cadence is consistent enough
 */

import { addDays, monthKey, parseISO } from './dates'
import type { Category, RecurringRule, Transaction } from './types'

const CADENCES: { frequency: RecurringRule['frequency']; days: number; tolerance: number }[] = [
  { frequency: 'weekly', days: 7, tolerance: 2 },
  { frequency: 'monthly', days: 30.44, tolerance: 6 },
  { frequency: 'quarterly', days: 91.3, tolerance: 12 },
  { frequency: 'yearly', days: 365.25, tolerance: 30 },
]

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function merchantKeyOf(t: Transaction): string {
  const base = (t.merchant || t.description || '').toLowerCase()
  return base
    .replace(/upi\/[a-z]+\/\d+\//gi, '')
    .replace(/\d{4,}/g, '')
    .replace(/[^\w\u0b80-\u0bff\u0900-\u097f ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
}

export interface DetectOptions {
  today?: string
  minOccurrences?: number
}

export function detectRecurring(txns: Transaction[], options: DetectOptions = {}): RecurringRule[] {
  const minOccurrences = options.minOccurrences ?? 3
  const groups = new Map<string, Transaction[]>()
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const key = merchantKeyOf(t)
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }

  const out: RecurringRule[] = []
  for (const [key, rawItems] of groups) {
    const items = [...rawItems].sort((a, b) => (a.date < b.date ? -1 : 1))
    if (items.length < minOccurrences) continue

    // One charge per calendar day: a split payment is still one occurrence.
    const byDay = new Map<string, Transaction[]>()
    for (const t of items) {
      const arr = byDay.get(t.date) ?? []
      arr.push(t)
      byDay.set(t.date, arr)
    }
    const dayList = [...byDay.keys()].sort()
    if (dayList.length < minOccurrences) continue

    const gaps: number[] = []
    for (let i = 1; i < dayList.length; i++) {
      const a = parseISO(dayList[i - 1])
      const b = parseISO(dayList[i])
      if (a && b) gaps.push(Math.round((b.getTime() - a.getTime()) / 86400000))
    }
    if (!gaps.length) continue

    const medGap = median(gaps)
    const cadence = CADENCES.find((c) => Math.abs(medGap - c.days) <= c.tolerance)
    if (!cadence) continue

    // Regularity: how tightly the gaps cluster around the median.
    const gapDeviation = median(gaps.map((g) => Math.abs(g - medGap)))
    const gapScore = Math.max(0, 1 - gapDeviation / Math.max(3, cadence.days * 0.25))

    const amounts = items.map((t) => t.amountPaise)
    const meanAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const amountDeviation =
      meanAmount > 0 ? median(amounts.map((a) => Math.abs(a - meanAmount))) / meanAmount : 1
    const amountScore = Math.max(0, 1 - amountDeviation / 0.35)

    const coverage = Math.min(1, dayList.length / 6)
    const confidence = Math.min(0.99, gapScore * 0.5 + amountScore * 0.3 + coverage * 0.2)
    if (confidence < 0.45) continue

    const last = dayList[dayList.length - 1]
    const intervalDays = Math.round(medGap)
    const categoryCounts = new Map<Category, number>()
    for (const t of items) categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1)
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    const displayName = items[items.length - 1].merchant || key
    out.push({
      id: `rec-${key.replace(/\s+/g, '-')}`,
      merchantKey: key,
      name: displayName,
      merchant: displayName,
      category,
      averagePaise: Math.round(meanAmount),
      frequency: cadence.frequency,
      intervalDays,
      occurrences: dayList.length,
      lastDate: last,
      nextDate: addDays(last, intervalDays),
      confidence,
      status: 'detected',
      txnIds: items.map((t) => t.id),
    })
  }

  return out.sort((a, b) => b.averagePaise * monthlyFactor(b) - a.averagePaise * monthlyFactor(a))
}

export function monthlyFactor(rule: Pick<RecurringRule, 'frequency'>): number {
  switch (rule.frequency) {
    case 'weekly':
      return 52 / 12
    case 'monthly':
      return 1
    case 'quarterly':
      return 1 / 3
    case 'yearly':
      return 1 / 12
  }
}

/** Normalised monthly cost of a rule, for the "recurring share of spend" stat. */
export function monthlyCostPaise(rule: RecurringRule): number {
  return Math.round(rule.averagePaise * monthlyFactor(rule))
}

export function recurringMonthlyTotal(rules: RecurringRule[]): number {
  return rules.filter((r) => r.status !== 'dismissed').reduce((a, r) => a + monthlyCostPaise(r), 0)
}

export interface UpcomingPayment extends RecurringRule {
  daysUntil: number
}

export function upcomingPayments(rules: RecurringRule[], today: string, withinDays = 30): UpcomingPayment[] {
  const t = parseISO(today)
  if (!t) return []
  return rules
    .filter((r) => r.status !== 'dismissed')
    .map((r) => {
      // Roll the projection forward if the stored next date is already past.
      let next = r.nextDate
      let guard = 0
      while (next < today && guard++ < 24) next = addDays(next, r.intervalDays)
      const d = parseISO(next)
      const daysUntil = d ? Math.round((d.getTime() - t.getTime()) / 86400000) : 999
      return { ...r, nextDate: next, daysUntil }
    })
    .filter((r) => r.daysUntil >= 0 && r.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

/**
 * Merge freshly detected rules with the user's confirm/dismiss/edit decisions.
 * User state always wins; only the computed statistics refresh.
 */
export function mergeRecurring(detected: RecurringRule[], existing: RecurringRule[]): RecurringRule[] {
  const byKey = new Map(existing.map((r) => [r.merchantKey, r]))
  const merged = detected.map((d) => {
    const prev = byKey.get(d.merchantKey)
    if (!prev) return d
    return {
      ...d,
      id: prev.id,
      name: prev.name !== prev.merchant ? prev.name : d.name,
      category: prev.status === 'confirmed' ? prev.category : d.category,
      status: prev.status,
    }
  })
  // Keep dismissed rules that no longer trigger, so they stay dismissed.
  const detectedKeys = new Set(detected.map((d) => d.merchantKey))
  for (const prev of existing) {
    if (prev.status === 'dismissed' && !detectedKeys.has(prev.merchantKey)) merged.push(prev)
  }
  return merged
}

/** Which recurring charges have actually landed in a given month. */
export function recurringActivity(rules: RecurringRule[], txns: Transaction[], month: string) {
  const ids = new Set(txns.filter((t) => monthKey(t.date) === month).map((t) => t.id))
  return rules.map((r) => ({ rule: r, chargedThisMonth: r.txnIds.some((id) => ids.has(id)) }))
}
