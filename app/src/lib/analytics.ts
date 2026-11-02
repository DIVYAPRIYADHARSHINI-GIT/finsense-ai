/**
 * Pure analytics derived from the transaction list.
 *
 * NOTHING in here is stored. Every metric, chart series, budget utilisation and
 * insight is recomputed from the single transaction array, which is why editing
 * or deleting one transaction instantly corrects the dashboard, the reports and
 * last month's numbers together. This is the "one source of truth" rule from
 * the brief, enforced structurally rather than by convention.
 */

import { addDays, daysInMonth, monthKey, monthLabel, monthRange, parseISO, weekKey } from './dates'
import type { Budget, Category, Transaction } from './types'

export interface DateFilter {
  from?: string
  to?: string
}

export function filterByDate(txns: Transaction[], filter: DateFilter): Transaction[] {
  if (!filter.from && !filter.to) return txns
  return txns.filter((t) => (!filter.from || t.date >= filter.from) && (!filter.to || t.date <= filter.to))
}

export function sumPaise(txns: Transaction[]): number {
  return txns.reduce((a, t) => a + t.amountPaise, 0)
}

export interface Totals {
  incomePaise: number
  expensePaise: number
  balancePaise: number
  savingsPaise: number
  savingsRate: number
  avgDailySpendPaise: number
  transactionCount: number
  dayCount: number
}

export function computeTotals(txns: Transaction[], filter: DateFilter = {}): Totals {
  const income = txns.filter((t) => t.type === 'income')
  const expense = txns.filter((t) => t.type === 'expense')
  const incomePaise = sumPaise(income)
  const expensePaise = sumPaise(expense)

  // Average daily spend uses the real observed span, not a nominal 30 days,
  // so a part-month filter is not understated.
  let dayCount = 0
  if (txns.length) {
    const dates = txns.map((t) => t.date).sort()
    const from = filter.from ?? dates[0]
    const to = filter.to ?? dates[dates.length - 1]
    const a = parseISO(from)
    const b = parseISO(to)
    if (a && b) dayCount = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1)
  }

  return {
    incomePaise,
    expensePaise,
    balancePaise: incomePaise - expensePaise,
    savingsPaise: Math.max(0, incomePaise - expensePaise),
    savingsRate: incomePaise > 0 ? (incomePaise - expensePaise) / incomePaise : 0,
    avgDailySpendPaise: dayCount > 0 ? Math.round(expensePaise / dayCount) : 0,
    transactionCount: txns.length,
    dayCount,
  }
}

export interface MonthlyPoint {
  month: string
  label: string
  incomePaise: number
  expensePaise: number
  savingsPaise: number
  cumulativeSavingsPaise: number
}

export function monthlySeries(txns: Transaction[]): MonthlyPoint[] {
  if (!txns.length) return []
  const dates = txns.map((t) => t.date).sort()
  const keys = monthRange(dates[0], dates[dates.length - 1])
  const byMonth = new Map<string, { inc: number; exp: number }>()
  for (const k of keys) byMonth.set(k, { inc: 0, exp: 0 })
  for (const t of txns) {
    const k = monthKey(t.date)
    const slot = byMonth.get(k)
    if (!slot) continue
    if (t.type === 'income') slot.inc += t.amountPaise
    else slot.exp += t.amountPaise
  }
  let cumulative = 0
  return keys.map((k) => {
    const { inc, exp } = byMonth.get(k)!
    cumulative += inc - exp
    return {
      month: k,
      label: monthLabel(k),
      incomePaise: inc,
      expensePaise: exp,
      savingsPaise: inc - exp,
      cumulativeSavingsPaise: cumulative,
    }
  })
}

export interface CategoryPoint {
  category: Category
  paise: number
  share: number
  count: number
}

export function categoryBreakdown(txns: Transaction[], type: 'expense' | 'income' = 'expense'): CategoryPoint[] {
  const rows = txns.filter((t) => t.type === type)
  const total = sumPaise(rows)
  const map = new Map<Category, { paise: number; count: number }>()
  for (const t of rows) {
    const cur = map.get(t.category) ?? { paise: 0, count: 0 }
    cur.paise += t.amountPaise
    cur.count += 1
    map.set(t.category, cur)
  }
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      paise: v.paise,
      count: v.count,
      share: total > 0 ? v.paise / total : 0,
    }))
    .sort((a, b) => b.paise - a.paise)
}

export interface WeeklyPoint {
  week: string
  label: string
  expensePaise: number
}

export function weeklySeries(txns: Transaction[], limit = 12): WeeklyPoint[] {
  const map = new Map<string, number>()
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const k = weekKey(t.date)
    map.set(k, (map.get(k) ?? 0) + t.amountPaise)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-limit)
    .map(([week, paise]) => ({ week, label: week.replace(/^\d{4}-/, ''), expensePaise: paise }))
}

export interface DailyPoint {
  date: string
  expensePaise: number
}

export function dailySeries(txns: Transaction[], fromISO: string, toISOStr: string): DailyPoint[] {
  const map = new Map<string, number>()
  for (const t of txns) {
    if (t.type !== 'expense') continue
    if (t.date < fromISO || t.date > toISOStr) continue
    map.set(t.date, (map.get(t.date) ?? 0) + t.amountPaise)
  }
  const out: DailyPoint[] = []
  let cursor = fromISO
  let guard = 0
  while (cursor <= toISOStr && guard++ < 1500) {
    out.push({ date: cursor, expensePaise: map.get(cursor) ?? 0 })
    cursor = addDays(cursor, 1)
  }
  return out
}

export interface BudgetStatus {
  category: Category | '__total__'
  limitPaise: number
  spentPaise: number
  utilisation: number
  remainingPaise: number
  state: 'ok' | 'warning' | 'exceeded'
  /** Pro-rated expectation for the month-to-date, used for pace alerts. */
  pacePaise: number
  overPace: boolean
}

export function budgetStatus(txns: Transaction[], budgets: Budget[], month: string, today?: string): BudgetStatus[] {
  const monthTxns = txns.filter((t) => t.type === 'expense' && monthKey(t.date) === month)
  const total = sumPaise(monthTxns)
  const dim = daysInMonth(month)
  const todayKey = today ?? ''
  const elapsed = todayKey.startsWith(month) ? Number(todayKey.slice(8, 10)) : dim
  const fraction = Math.min(1, Math.max(0.03, elapsed / dim))

  return budgets
    .filter((b) => b.limitPaise > 0)
    .map((b) => {
      const spent = b.category === '__total__' ? total : sumPaise(monthTxns.filter((t) => t.category === b.category))
      const utilisation = b.limitPaise > 0 ? spent / b.limitPaise : 0
      const pace = Math.round(b.limitPaise * fraction)
      return {
        category: b.category,
        limitPaise: b.limitPaise,
        spentPaise: spent,
        utilisation,
        remainingPaise: b.limitPaise - spent,
        state: utilisation >= 1 ? 'exceeded' : utilisation >= 0.8 ? 'warning' : 'ok',
        pacePaise: pace,
        overPace: spent > pace && utilisation < 1,
      } satisfies BudgetStatus
    })
    .sort((a, b) => b.utilisation - a.utilisation)
}

/** Month-over-month category deltas, the backbone of the Insights page. */
export interface CategoryDelta {
  category: Category
  currentPaise: number
  previousPaise: number
  deltaPaise: number
  deltaRatio: number | null
  currentCount: number
}

export function categoryDeltas(txns: Transaction[], month: string, previousMonth: string): CategoryDelta[] {
  const cur = categoryBreakdown(txns.filter((t) => monthKey(t.date) === month))
  const prev = categoryBreakdown(txns.filter((t) => monthKey(t.date) === previousMonth))
  const prevMap = new Map(prev.map((p) => [p.category, p.paise]))
  const cats = new Set<Category>([...cur.map((c) => c.category), ...prev.map((c) => c.category)])
  return [...cats]
    .map((category) => {
      const currentPaise = cur.find((c) => c.category === category)?.paise ?? 0
      const previousPaise = prevMap.get(category) ?? 0
      return {
        category,
        currentPaise,
        previousPaise,
        deltaPaise: currentPaise - previousPaise,
        deltaRatio: previousPaise > 0 ? (currentPaise - previousPaise) / previousPaise : null,
        currentCount: cur.find((c) => c.category === category)?.count ?? 0,
      }
    })
    .sort((a, b) => Math.abs(b.deltaPaise) - Math.abs(a.deltaPaise))
}

/** Day-of-week spending profile (used by forecast explanations and reports). */
export function dayOfWeekProfile(txns: Transaction[]): { day: string; averagePaise: number }[] {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const sums = new Array(7).fill(0)
  const counts = new Array(7).fill(0)
  const seen = new Set<string>()
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const d = parseISO(t.date)
    if (!d) continue
    const idx = (d.getDay() + 6) % 7
    sums[idx] += t.amountPaise
    if (!seen.has(t.date)) {
      seen.add(t.date)
      counts[idx] += 1
    }
  }
  return names.map((day, i) => ({ day, averagePaise: counts[i] > 0 ? Math.round(sums[i] / counts[i]) : 0 }))
}

export function highestSpendCategory(txns: Transaction[]): CategoryPoint | null {
  return categoryBreakdown(txns)[0] ?? null
}

/** Detect near-identical transactions already in the store. */
export function findDuplicates(txns: Transaction[]): Transaction[][] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txns) {
    const text = `${t.merchant} ${t.description}`.toLowerCase().replace(/\s+/g, ' ').trim()
    const key = `${t.date}|${t.amountPaise}|${text}`
    const arr = groups.get(key) ?? []
    arr.push(t)
    groups.set(key, arr)
  }
  return [...groups.values()].filter((g) => g.length > 1)
}
