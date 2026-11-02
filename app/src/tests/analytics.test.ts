/** Analytics, money, dates, recurring detection, insights and the PDF writer. */

import { describe, expect, it } from 'vitest'
import {
  budgetStatus,
  categoryBreakdown,
  categoryDeltas,
  computeTotals,
  dailySeries,
  dayOfWeekProfile,
  filterByDate,
  findDuplicates,
  monthlySeries,
  weeklySeries,
} from '../lib/analytics'
import { formatMoney, formatPercent, toMajor, toPaise } from '../lib/money'
import { addDays, addMonths, daysInMonth, formatDate, isValidISO, monthKey, monthRange, parseISO, weekKey } from '../lib/dates'
import { detectRecurring, mergeRecurring, monthlyCostPaise, recurringMonthlyTotal, upcomingPayments } from '../lib/recurring'
import { buildInsights, buildRecommendations } from '../lib/insights'
import { buildPdf, sanitiseForPdf, textWidth } from '../lib/pdf'
import { generateSampleTransactions, sampleDataSummary } from '../lib/sample-data'
import { DEFAULT_SETTINGS, type Budget, type Category, type Transaction } from '../lib/types'

let seq = 0
function txn(partial: Partial<Transaction> & { date: string; amountPaise: number }): Transaction {
  seq += 1
  return {
    id: `t${seq}`,
    description: '',
    merchant: 'Merchant',
    type: 'expense',
    category: 'Other',
    paymentMethod: 'UPI',
    notes: '',
    categorySource: 'user',
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('money', () => {
  it('rounds to integer paise exactly once', () => {
    expect(toPaise(1234.565)).toBe(123457)
    expect(toPaise('1,234.56')).toBe(123456)
    expect(toPaise('₹999.99')).toBe(99999)
    expect(toMajor(123456)).toBeCloseTo(1234.56)
  })

  it('never drifts when summing many values', () => {
    // The classic float failure: 0.1 + 0.2 repeated.
    const paise = Array.from({ length: 1000 }, () => toPaise(0.1))
    expect(paise.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(toMajor(paise.reduce((a, b) => a + b, 0))).toBe(100)
  })

  it('formats currency and percentages', () => {
    expect(formatMoney(123456, 'INR')).toMatch(/1,234\.56/)
    expect(formatMoney(0, 'INR')).toMatch(/0\.00/)
    expect(formatPercent(0.1734)).toBe('17.3%')
    expect(formatPercent(Number.NaN)).toBe('--')
  })

  it('handles invalid numeric input without producing NaN money', () => {
    expect(toPaise('abc')).toBe(0)
    expect(toPaise(Number.NaN)).toBe(0)
  })
})

describe('dates', () => {
  it('parses and validates civil dates', () => {
    expect(isValidISO('2025-03-31')).toBe(true)
    expect(isValidISO('2025-02-30')).toBe(false)
    expect(parseISO('2025-03-31')?.getDate()).toBe(31)
  })

  it('anchors at local noon so DST cannot shift the day', () => {
    // 2025-03-09 is a US DST transition; 2025-10-26 is a EU one.
    for (const iso of ['2025-03-09', '2025-10-26', '2025-11-02']) {
      const d = parseISO(iso)!
      expect(d.getHours()).toBe(12)
      expect(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe(iso)
    }
  })

  it('adds days and months, clamping short months', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28')
    expect(addMonths('2025-03-15', -1)).toBe('2025-02-15')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29') // leap year
  })

  it('computes month keys, ranges and lengths', () => {
    expect(monthKey('2025-07-04')).toBe('2025-07')
    expect(daysInMonth('2025-02')).toBe(28)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(monthRange('2025-01-15', '2025-04-02')).toEqual(['2025-01', '2025-02', '2025-03', '2025-04'])
  })

  it('computes Monday-based ISO week keys', () => {
    expect(weekKey('2025-01-01')).toMatch(/^2025-W01$/)
    expect(weekKey('2025-06-16')).toMatch(/^2025-W\d{2}$/)
  })

  it('formats dates in each supported format', () => {
    expect(formatDate('2025-03-31', 'dd MMM yyyy')).toBe('31 Mar 2025')
    expect(formatDate('2025-03-31', 'dd/MM/yyyy')).toBe('31/03/2025')
    expect(formatDate('2025-03-31', 'MM/dd/yyyy')).toBe('03/31/2025')
    expect(formatDate('2025-03-31', 'yyyy-MM-dd')).toBe('2025-03-31')
  })
})

describe('totals and series', () => {
  const data = [
    txn({ date: '2025-01-05', amountPaise: 100000, type: 'income', category: 'Salary' }),
    txn({ date: '2025-01-10', amountPaise: 30000, category: 'Food & Dining' }),
    txn({ date: '2025-01-20', amountPaise: 20000, category: 'Groceries' }),
    txn({ date: '2025-02-05', amountPaise: 100000, type: 'income', category: 'Salary' }),
    txn({ date: '2025-02-11', amountPaise: 60000, category: 'Shopping' }),
  ]

  it('computes income, expenses, balance and savings rate', () => {
    const t = computeTotals(data)
    expect(t.incomePaise).toBe(200000)
    expect(t.expensePaise).toBe(110000)
    expect(t.balancePaise).toBe(90000)
    expect(t.savingsRate).toBeCloseTo(0.45)
  })

  it('reports a zero savings rate rather than Infinity when income is zero', () => {
    const t = computeTotals([txn({ date: '2025-01-01', amountPaise: 5000 })])
    expect(t.savingsRate).toBe(0)
    expect(Number.isFinite(t.savingsRate)).toBe(true)
  })

  it('averages daily spend over the real observed span', () => {
    const t = computeTotals(data)
    expect(t.dayCount).toBeGreaterThan(30)
    expect(t.avgDailySpendPaise).toBe(Math.round(110000 / t.dayCount))
  })

  it('produces a continuous monthly series with cumulative savings', () => {
    const s = monthlySeries(data)
    expect(s.map((x) => x.month)).toEqual(['2025-01', '2025-02'])
    expect(s[0].savingsPaise).toBe(50000)
    expect(s[1].cumulativeSavingsPaise).toBe(90000)
  })

  it('fills gap months with zeros instead of skipping them', () => {
    const sparse = [
      txn({ date: '2025-01-01', amountPaise: 1000 }),
      txn({ date: '2025-04-01', amountPaise: 1000 }),
    ]
    const s = monthlySeries(sparse)
    expect(s.map((x) => x.month)).toEqual(['2025-01', '2025-02', '2025-03', '2025-04'])
    expect(s[1].expensePaise).toBe(0)
  })

  it('returns an empty series for no transactions', () => {
    expect(monthlySeries([])).toEqual([])
    expect(categoryBreakdown([])).toEqual([])
    expect(weeklySeries([])).toEqual([])
  })

  it('breaks down categories by share, sorted descending', () => {
    const b = categoryBreakdown(data)
    expect(b[0].category).toBe('Shopping')
    expect(b[0].paise).toBe(60000)
    expect(b.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1)
  })

  it('filters by date range inclusively', () => {
    expect(filterByDate(data, { from: '2025-02-01' })).toHaveLength(2)
    expect(filterByDate(data, { to: '2025-01-31' })).toHaveLength(3)
    expect(filterByDate(data, { from: '2025-01-10', to: '2025-01-20' })).toHaveLength(2)
  })

  it('builds a dense daily series including zero days', () => {
    const d = dailySeries(data, '2025-01-09', '2025-01-12')
    expect(d).toHaveLength(4)
    expect(d[1].expensePaise).toBe(30000)
    expect(d[2].expensePaise).toBe(0)
  })

  it('computes a 7-entry day-of-week profile', () => {
    const p = dayOfWeekProfile(data)
    expect(p).toHaveLength(7)
    expect(p[0].day).toBe('Mon')
  })

  it('computes month-over-month category deltas', () => {
    const d = categoryDeltas(data, '2025-02', '2025-01')
    const shopping = d.find((x) => x.category === 'Shopping')!
    expect(shopping.currentPaise).toBe(60000)
    expect(shopping.previousPaise).toBe(0)
    expect(shopping.deltaRatio).toBeNull() // no base to divide by
  })

  it('finds duplicate groups by date + amount + text', () => {
    const dupes = [
      txn({ date: '2025-01-01', amountPaise: 5000, merchant: 'Shop' }),
      txn({ date: '2025-01-01', amountPaise: 5000, merchant: 'Shop' }),
      txn({ date: '2025-01-02', amountPaise: 5000, merchant: 'Shop' }),
    ]
    const groups = findDuplicates(dupes)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })
})

describe('budgets', () => {
  const data = [
    txn({ date: '2025-06-02', amountPaise: 50000, category: 'Food & Dining' }),
    txn({ date: '2025-06-09', amountPaise: 40000, category: 'Food & Dining' }),
    txn({ date: '2025-06-10', amountPaise: 20000, category: 'Shopping' }),
  ]
  const budgets: Budget[] = [
    { category: 'Food & Dining', limitPaise: 100000 },
    { category: 'Shopping', limitPaise: 10000 },
    { category: '__total__', limitPaise: 200000 },
  ]

  it('computes utilisation and flags exceeded budgets', () => {
    const rows = budgetStatus(data, budgets, '2025-06', '2025-06-30')
    const shopping = rows.find((r) => r.category === 'Shopping')!
    expect(shopping.state).toBe('exceeded')
    expect(shopping.remainingPaise).toBe(-10000)
    const food = rows.find((r) => r.category === 'Food & Dining')!
    expect(food.utilisation).toBeCloseTo(0.9)
    expect(food.state).toBe('warning')
  })

  it('aggregates the special total budget across all categories', () => {
    const total = budgetStatus(data, budgets, '2025-06', '2025-06-30').find((r) => r.category === '__total__')!
    expect(total.spentPaise).toBe(110000)
  })

  it('detects spending ahead of the month-to-date pace', () => {
    // 90,000 of a 100,000 budget spent by the 10th of a 30-day month.
    const rows = budgetStatus(data, budgets, '2025-06', '2025-06-10')
    const food = rows.find((r) => r.category === 'Food & Dining')!
    expect(food.overPace).toBe(true)
    expect(food.pacePaise).toBeLessThan(food.spentPaise)
  })

  it('ignores zero-limit budgets', () => {
    expect(budgetStatus(data, [{ category: 'Travel', limitPaise: 0 }], '2025-06')).toHaveLength(0)
  })
})

describe('recurring detection', () => {
  const monthly = (merchant: string, amount: number, day: number, months: string[]) =>
    months.map((m) => txn({ date: `${m}-${String(day).padStart(2, '0')}`, amountPaise: amount, merchant, category: 'Subscriptions' }))

  it('detects a fixed monthly subscription', () => {
    const rules = detectRecurring(monthly('StreamNest', 49900, 9, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05']))
    expect(rules).toHaveLength(1)
    expect(rules[0].frequency).toBe('monthly')
    expect(rules[0].averagePaise).toBe(49900)
    expect(rules[0].confidence).toBeGreaterThan(0.7)
  })

  it('detects a weekly cadence', () => {
    const weekly = ['2025-03-03', '2025-03-10', '2025-03-17', '2025-03-24', '2025-03-31'].map((d) =>
      txn({ date: d, amountPaise: 24000, merchant: 'MorningFresh Milk', category: 'Groceries' }),
    )
    const rules = detectRecurring(weekly)
    expect(rules[0].frequency).toBe('weekly')
    expect(rules[0].intervalDays).toBe(7)
  })

  it('detects a quarterly cadence', () => {
    const quarterly = ['2025-01-15', '2025-04-15', '2025-07-15', '2025-10-15'].map((d) =>
      txn({ date: d, amountPaise: 620000, merchant: 'SafeGuard Insurance', category: 'Healthcare' }),
    )
    expect(detectRecurring(quarterly)[0].frequency).toBe('quarterly')
  })

  it('ignores irregular one-off spending', () => {
    const random = ['2025-01-03', '2025-01-19', '2025-02-27', '2025-05-02'].map((d, i) =>
      txn({ date: d, amountPaise: 1000 * (i + 1) * 7, merchant: 'Random Shop' }),
    )
    expect(detectRecurring(random)).toHaveLength(0)
  })

  it('requires at least three charges', () => {
    expect(detectRecurring(monthly('Twice', 1000, 5, ['2025-01', '2025-02']))).toHaveLength(0)
  })

  it('normalises cost to a monthly figure by frequency', () => {
    const weekly = { frequency: 'weekly' as const, averagePaise: 24000 }
    const yearly = { frequency: 'yearly' as const, averagePaise: 1200000 }
    expect(monthlyCostPaise(weekly as never)).toBe(Math.round(24000 * (52 / 12)))
    expect(monthlyCostPaise(yearly as never)).toBe(100000)
  })

  it('projects the next payment date past today', () => {
    const rules = detectRecurring(monthly('StreamNest', 49900, 9, ['2025-01', '2025-02', '2025-03', '2025-04']))
    const up = upcomingPayments(rules, '2025-05-01', 30)
    expect(up).toHaveLength(1)
    expect(up[0].nextDate >= '2025-05-01').toBe(true)
    expect(up[0].daysUntil).toBeGreaterThanOrEqual(0)
  })

  it('keeps user confirm/dismiss decisions through re-detection', () => {
    const detected = detectRecurring(monthly('StreamNest', 49900, 9, ['2025-01', '2025-02', '2025-03', '2025-04']))
    const confirmed = detected.map((r) => ({ ...r, status: 'confirmed' as const, name: 'My Streaming' }))
    const merged = mergeRecurring(detected, confirmed)
    expect(merged[0].status).toBe('confirmed')
    expect(merged[0].name).toBe('My Streaming')
  })

  it('keeps a dismissed rule dismissed even if it stops being detected', () => {
    const stale = [
      {
        id: 'rec-gone',
        merchantKey: 'gone',
        name: 'Gone',
        merchant: 'Gone',
        category: 'Other' as Category,
        averagePaise: 1000,
        frequency: 'monthly' as const,
        intervalDays: 30,
        occurrences: 3,
        lastDate: '2024-01-01',
        nextDate: '2024-02-01',
        confidence: 0.8,
        status: 'dismissed' as const,
        txnIds: [],
      },
    ]
    const merged = mergeRecurring([], stale)
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('dismissed')
  })

  it('excludes dismissed rules from the monthly total', () => {
    const rules = detectRecurring(monthly('StreamNest', 49900, 9, ['2025-01', '2025-02', '2025-03', '2025-04']))
    expect(recurringMonthlyTotal(rules)).toBe(49900)
    expect(recurringMonthlyTotal(rules.map((r) => ({ ...r, status: 'dismissed' as const })))).toBe(0)
  })
})

describe('insights and recommendations', () => {
  const base = {
    budgets: [] as Budget[],
    settings: DEFAULT_SETTINGS,
    recurring: [],
    today: '2025-06-15',
  }

  it('produces no insights for an empty dataset', () => {
    expect(buildInsights({ ...base, transactions: [] })).toEqual([])
  })

  it('reports a real month-over-month decrease as positive', () => {
    const transactions = [
      ...Array.from({ length: 5 }, (_, i) => txn({ date: `2025-05-0${i + 1}`, amountPaise: 100000 })),
      ...Array.from({ length: 5 }, (_, i) => txn({ date: `2025-06-0${i + 1}`, amountPaise: 50000 })),
    ]
    const found = buildInsights({ ...base, transactions }).find((i) => i.key.startsWith('spend-mom'))
    expect(found).toBeDefined()
    expect(found!.tone).toBe('positive')
    expect(found!.title).toMatch(/less/)
    expect(found!.evidence.length).toBeGreaterThan(0)
  })

  it('attaches supporting evidence to every insight', () => {
    const transactions = [
      txn({ date: '2025-05-01', amountPaise: 300000, type: 'income', category: 'Salary' }),
      txn({ date: '2025-05-05', amountPaise: 100000, category: 'Shopping' }),
      txn({ date: '2025-06-05', amountPaise: 140000, category: 'Shopping' }),
    ]
    const insights = buildInsights({ ...base, transactions })
    expect(insights.length).toBeGreaterThan(0)
    for (const i of insights) expect(i.evidence.length).toBeGreaterThan(0)
  })

  it('generates stable keys so a dismissal survives recomputation', () => {
    const transactions = [txn({ date: '2025-06-01', amountPaise: 100000, type: 'income', category: 'Salary' })]
    const a = buildInsights({ ...base, transactions }).map((i) => i.key)
    const b = buildInsights({ ...base, transactions }).map((i) => i.key)
    expect(a).toEqual(b)
  })

  it('flags an exceeded budget as critical', () => {
    const transactions = [txn({ date: '2025-06-02', amountPaise: 200000, category: 'Shopping' })]
    const insights = buildInsights({
      ...base,
      transactions,
      budgets: [{ category: 'Shopping', limitPaise: 100000 }],
    })
    const b = insights.find((i) => i.key.includes('budget-exceeded'))
    expect(b?.tone).toBe('critical')
  })

  it('refuses to recommend without enough history', () => {
    expect(buildRecommendations({ ...base, transactions: [] })).toEqual([])
    const tiny = [txn({ date: '2025-06-01', amountPaise: 1000 })]
    expect(buildRecommendations({ ...base, transactions: tiny })).toEqual([])
  })

  it('sizes recommendations from real category averages', () => {
    const transactions: Transaction[] = []
    for (const m of ['2025-03', '2025-04', '2025-05']) {
      transactions.push(txn({ date: `${m}-01`, amountPaise: 9000000, type: 'income', category: 'Salary' }))
      for (let d = 1; d <= 10; d++) {
        transactions.push(txn({ date: `${m}-${String(d).padStart(2, '0')}`, amountPaise: 100000, category: 'Shopping' }))
      }
    }
    const recs = buildRecommendations({ ...base, transactions })
    const shopping = recs.find((r) => r.category === 'Shopping')
    expect(shopping).toBeDefined()
    expect(shopping!.estimatedSavingPaise).toBeGreaterThan(0)
    // Shopping averages 1,000,000 paise/month; the trim must be a sane fraction.
    expect(shopping!.estimatedSavingPaise).toBeLessThan(1000000)
    expect(shopping!.evidence.length).toBe(3)
  })
})

describe('sample dataset', () => {
  const txns = generateSampleTransactions({ today: '2025-11-02' })

  it('generates at least 500 transactions across 12 months', () => {
    const s = sampleDataSummary(txns)
    expect(s.count).toBeGreaterThanOrEqual(500)
    expect(s.months).toBe(12)
  })

  it('covers all 14 categories', () => {
    expect(new Set(txns.map((t) => t.category)).size).toBe(14)
  })

  it('is deterministic for a fixed seed', () => {
    const again = generateSampleTransactions({ today: '2025-11-02' })
    expect(again.length).toBe(txns.length)
    expect(again.map((t) => `${t.date}|${t.amountPaise}|${t.merchant}`)).toEqual(
      txns.map((t) => `${t.date}|${t.amountPaise}|${t.merchant}`),
    )
  })

  it('never contains a future-dated transaction', () => {
    expect(txns.every((t) => t.date <= '2025-11-02')).toBe(true)
  })

  it('shows a realistic positive savings rate', () => {
    const t = computeTotals(txns)
    expect(t.savingsRate).toBeGreaterThan(0.05)
    expect(t.savingsRate).toBeLessThan(0.5)
  })

  it('includes Tamil and Hindi merchants for Unicode coverage', () => {
    expect(txns.some((t) => /[\u0B80-\u0BFF]/.test(t.merchant))).toBe(true)
    expect(txns.some((t) => /[\u0900-\u097F]/.test(t.merchant))).toBe(true)
  })

  it('includes the recurring commitments the detector should find', () => {
    const rules = detectRecurring(txns, { today: '2025-11-02' })
    const names = rules.map((r) => r.merchant.toLowerCase()).join(' ')
    expect(names).toMatch(/greenleaf/)
    expect(rules.filter((r) => r.category === 'Subscriptions').length).toBeGreaterThanOrEqual(3)
  })

  it('includes planted high-value outliers for anomaly detection', () => {
    const big = txns.filter((t) => t.type === 'expense' && t.amountPaise > 1500000)
    expect(big.length).toBeGreaterThanOrEqual(4)
  })

  it('produces varied narrations so the classifier cannot just memorise strings', () => {
    const fresh = txns.filter((t) => t.merchant === 'FreshCart Supermarket')
    expect(new Set(fresh.map((t) => t.description)).size).toBeGreaterThan(5)
  })
})

describe('PDF writer', () => {
  it('measures Helvetica text widths', () => {
    expect(textWidth('iii', 10)).toBeLessThan(textWidth('WWW', 10))
    expect(textWidth('', 10)).toBe(0)
    expect(textWidth('Hello', 20)).toBeCloseTo(textWidth('Hello', 10) * 2)
  })

  it('reports when text cannot be drawn by the base-14 fonts', () => {
    expect(sanitiseForPdf('Plain ASCII').lossy).toBe(false)
    expect(sanitiseForPdf('அண்ணா மெஸ்').lossy).toBe(true)
    expect(sanitiseForPdf('चाय').lossy).toBe(true)
    // The rupee sign is substituted rather than dropped.
    expect(sanitiseForPdf('\u20B9100').text).toBe('Rs.100')
    expect(sanitiseForPdf('\u20B9100').lossy).toBe(false)
  })

  it('emits a structurally valid PDF', async () => {
    const { blob } = buildPdf({
      title: 'Test Report',
      subtitle: 'Generated by a test',
      sections: [
        { heading: 'Summary', keyValues: [['Total', 'Rs.1,000']] },
        { heading: 'Rows', table: { headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } },
      ],
    })
    const text = await blob.text()
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Type /Catalog')
    expect(text).toContain('/Type /Page')
    expect(text).toContain('startxref')
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(blob.size).toBeGreaterThan(800)
  })

  it('paginates long tables instead of overflowing one page', async () => {
    const rows = Array.from({ length: 220 }, (_, i) => [`Row ${i}`, String(i * 10)])
    const { blob } = buildPdf({
      title: 'Long',
      sections: [{ table: { headers: ['Name', 'Value'], rows } }],
    })
    const text = await blob.text()
    const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length
    expect(pageCount).toBeGreaterThan(1)
    expect(text).toContain('/Count ')
  })

  it('flags lossy output when given non-Latin text', () => {
    const { lossy } = buildPdf({
      title: 'Unicode',
      sections: [{ table: { headers: ['Merchant'], rows: [['அண்ணா மெஸ்']] } }],
    })
    expect(lossy).toBe(true)
  })
})
