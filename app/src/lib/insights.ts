/**
 * Insight and savings-recommendation engine.
 *
 * Every insight carries `evidence`: the exact comparison or transaction set it
 * was computed from, which the UI renders under "Why this?". Nothing here is a
 * canned sentence - if the data does not support a statement, the insight is
 * simply not generated. No LLM is involved, and none is needed.
 */

import { categoryBreakdown, categoryDeltas, computeTotals, monthlySeries } from './analytics'
import { monthKey, monthLabel, addMonths } from './dates'
import { monthlyCostPaise, recurringMonthlyTotal } from './recurring'
import type { Budget, Category, RecurringRule, Settings, Transaction } from './types'

export type InsightTone = 'positive' | 'neutral' | 'warning' | 'critical'

export interface Insight {
  /** Stable across recomputation so a dismissal sticks. */
  key: string
  title: string
  detail: string
  tone: InsightTone
  /** Higher sorts first. */
  weight: number
  evidence: string[]
  category?: Category
}

export interface InsightContext {
  transactions: Transaction[]
  recurring: RecurringRule[]
  budgets: Budget[]
  settings: Settings
  today: string
  /** Latest ML forecast, if one has been computed. */
  forecastPaise?: number | null
  forecastMonth?: string | null
  anomalyCount?: number
}

function pct(n: number): string {
  return `${Math.abs(n * 100).toFixed(0)}%`
}

export function buildInsights(ctx: InsightContext): Insight[] {
  const { transactions, recurring, budgets, today } = ctx
  const out: Insight[] = []
  if (!transactions.length) return out

  const thisMonth = monthKey(today)
  const prevMonth = monthKey(addMonths(`${thisMonth}-01`, -1))
  const monthTxns = transactions.filter((t) => monthKey(t.date) === thisMonth)
  const prevTxns = transactions.filter((t) => monthKey(t.date) === prevMonth)
  const monthTotals = computeTotals(monthTxns)
  const prevTotals = computeTotals(prevTxns)

  // --- month-over-month total spend -------------------------------------
  if (prevTotals.expensePaise > 0 && monthTxns.length >= 3) {
    const delta = monthTotals.expensePaise - prevTotals.expensePaise
    const ratio = delta / prevTotals.expensePaise
    if (Math.abs(ratio) >= 0.05) {
      out.push({
        key: `spend-mom-${thisMonth}`,
        title:
          delta < 0
            ? `You have spent ${pct(ratio)} less so far this month`
            : `Your spending is ${pct(ratio)} higher than last month`,
        detail:
          delta < 0
            ? `${monthLabel(thisMonth)} is tracking below ${monthLabel(prevMonth)}. Note that the current month may be incomplete.`
            : `${monthLabel(thisMonth)} is tracking above ${monthLabel(prevMonth)}. The current month may still be incomplete.`,
        tone: delta < 0 ? 'positive' : 'warning',
        weight: 80 + Math.min(15, Math.abs(ratio) * 40),
        evidence: [
          `${monthLabel(thisMonth)} expenses: ${monthTotals.expensePaise / 100} across ${monthTxns.filter((t) => t.type === 'expense').length} transactions`,
          `${monthLabel(prevMonth)} expenses: ${prevTotals.expensePaise / 100} across ${prevTxns.filter((t) => t.type === 'expense').length} transactions`,
        ],
      })
    }
  }

  // --- per-category movement ---------------------------------------------
  const deltas = categoryDeltas(transactions, thisMonth, prevMonth)
  for (const d of deltas.slice(0, 4)) {
    if (d.deltaRatio === null || d.previousPaise < 50000) continue // ignore noise under Rs 500
    if (Math.abs(d.deltaRatio) < 0.15) continue
    out.push({
      key: `cat-delta-${thisMonth}-${d.category}`,
      title: `Your ${d.category.toLowerCase()} expenses ${d.deltaRatio > 0 ? 'increased' : 'decreased'} by ${pct(d.deltaRatio)} compared with last month`,
      detail: `${d.currentCount} ${d.category} transactions so far in ${monthLabel(thisMonth)}.`,
      tone: d.deltaRatio > 0.3 ? 'warning' : d.deltaRatio < 0 ? 'positive' : 'neutral',
      weight: 70 + Math.min(20, Math.abs(d.deltaRatio) * 25),
      category: d.category,
      evidence: [
        `${monthLabel(thisMonth)} ${d.category}: ${d.currentPaise / 100}`,
        `${monthLabel(prevMonth)} ${d.category}: ${d.previousPaise / 100}`,
        `Change: ${d.deltaPaise / 100}`,
      ],
    })
  }

  // --- highest spending category ------------------------------------------
  const breakdown = categoryBreakdown(monthTxns.length >= 5 ? monthTxns : transactions)
  if (breakdown.length) {
    const top = breakdown[0]
    out.push({
      key: `top-category-${thisMonth}`,
      title: `${top.category} is your highest spending category`,
      detail: `It accounts for ${pct(top.share)} of the expenses in this view, across ${top.count} transactions.`,
      tone: top.share > 0.4 ? 'warning' : 'neutral',
      weight: 75,
      category: top.category,
      evidence: breakdown
        .slice(0, 3)
        .map((b) => `${b.category}: ${b.paise / 100} (${pct(b.share)})`),
    })
  }

  // --- recurring share -----------------------------------------------------
  const activeRecurring = recurring.filter((r) => r.status !== 'dismissed')
  if (activeRecurring.length) {
    const recurringTotal = recurringMonthlyTotal(activeRecurring)
    const series = monthlySeries(transactions)
    const completed = series.filter((s) => s.month < thisMonth)
    const avgMonthly =
      completed.length > 0
        ? completed.slice(-3).reduce((a, s) => a + s.expensePaise, 0) / Math.min(3, completed.length)
        : monthTotals.expensePaise
    if (avgMonthly > 0) {
      const share = recurringTotal / avgMonthly
      out.push({
        key: 'recurring-share',
        title: `Your recurring payments account for ${pct(share)} of your monthly expenses`,
        detail: `${activeRecurring.length} recurring charges worth about ${(recurringTotal / 100).toFixed(0)} per month were detected.`,
        tone: share > 0.45 ? 'warning' : 'neutral',
        weight: 72,
        evidence: activeRecurring
          .slice(0, 5)
          .map((r) => `${r.name}: ${(monthlyCostPaise(r) / 100).toFixed(0)}/month (${r.frequency})`),
      })
    }

    const subs = activeRecurring.filter((r) => r.category === 'Subscriptions')
    if (subs.length >= 3) {
      const subTotal = subs.reduce((a, r) => a + monthlyCostPaise(r), 0)
      out.push({
        key: 'subscription-review',
        title: `Review your ${subs.length} active subscriptions`,
        detail: `They cost about ${(subTotal / 100).toFixed(0)} per month, or ${((subTotal * 12) / 100).toFixed(0)} per year. Cancelling the ones you no longer use is the fastest saving available.`,
        tone: 'neutral',
        weight: 68,
        evidence: subs.map((r) => `${r.name}: ${(r.averagePaise / 100).toFixed(0)} ${r.frequency}, last charged ${r.lastDate}`),
      })
    }
  }

  // --- savings rate --------------------------------------------------------
  const allTotals = computeTotals(transactions)
  if (allTotals.incomePaise > 0) {
    const rate = allTotals.savingsRate
    out.push({
      key: 'savings-rate',
      title: `Your savings rate is ${pct(rate)}`,
      detail:
        rate >= 0.2
          ? 'That is in the commonly recommended 20%+ range. This is a calculation from your own data, not financial advice.'
          : rate > 0
            ? 'Many planners suggest aiming for 20%. This is a calculation from your own data, not financial advice.'
            : 'Your recorded expenses exceed your recorded income in this period.',
      tone: rate >= 0.2 ? 'positive' : rate > 0 ? 'neutral' : 'critical',
      weight: 85,
      evidence: [
        `Income: ${allTotals.incomePaise / 100}`,
        `Expenses: ${allTotals.expensePaise / 100}`,
        `Net: ${allTotals.balancePaise / 100}`,
      ],
    })
  }

  // --- forecast ------------------------------------------------------------
  if (ctx.forecastPaise && ctx.forecastMonth) {
    out.push({
      key: `forecast-${ctx.forecastMonth}`,
      title: `Your predicted expenses for ${monthLabel(ctx.forecastMonth)} are ${(ctx.forecastPaise / 100).toFixed(0)}`,
      detail: 'Produced by the trained forecasting model on the Expense Forecast page, including its uncertainty range.',
      tone: 'neutral',
      weight: 90,
      evidence: ['Open Expense Forecast to see model comparison, MAE and RMSE.'],
    })
  }

  // --- budgets -------------------------------------------------------------
  for (const b of budgets) {
    if (b.limitPaise <= 0) continue
    const spent =
      b.category === '__total__'
        ? monthTotals.expensePaise
        : monthTxns.filter((t) => t.type === 'expense' && t.category === b.category).reduce((a, t) => a + t.amountPaise, 0)
    const util = spent / b.limitPaise
    if (util >= 1) {
      out.push({
        key: `budget-exceeded-${thisMonth}-${b.category}`,
        title: `${b.category === '__total__' ? 'Your total monthly budget' : `Your ${b.category} budget`} is exceeded`,
        detail: `Spent ${(spent / 100).toFixed(0)} against a limit of ${(b.limitPaise / 100).toFixed(0)}.`,
        tone: 'critical',
        weight: 95,
        evidence: [`Utilisation: ${pct(util)}`],
      })
    } else if (util >= 0.8) {
      out.push({
        key: `budget-warning-${thisMonth}-${b.category}`,
        title: `${b.category === '__total__' ? 'Your total monthly budget' : `Your ${b.category} budget`} is ${pct(util)} used`,
        detail: `${((b.limitPaise - spent) / 100).toFixed(0)} remaining for ${monthLabel(thisMonth)}.`,
        tone: 'warning',
        weight: 88,
        evidence: [`Spent ${(spent / 100).toFixed(0)} of ${(b.limitPaise / 100).toFixed(0)}`],
      })
    }
  }

  // --- anomalies -----------------------------------------------------------
  if (ctx.anomalyCount && ctx.anomalyCount > 0) {
    out.push({
      key: 'anomaly-summary',
      title: `${ctx.anomalyCount} transaction${ctx.anomalyCount > 1 ? 's' : ''} flagged for review`,
      detail: 'The Isolation Forest model marked these as statistical outliers. Unusual does not mean fraudulent.',
      tone: 'warning',
      weight: 86,
      evidence: ['Open Anomaly Detection to review each flag and mark it as normal.'],
    })
  }

  return out.sort((a, b) => b.weight - a.weight)
}

// ---------------------------------------------------------------------------
// Savings recommendations
// ---------------------------------------------------------------------------

export interface Recommendation {
  key: string
  title: string
  rationale: string
  /** Estimated monthly saving if acted on, in paise. Always shown as an estimate. */
  estimatedSavingPaise: number
  difficulty: 'easy' | 'moderate' | 'ambitious'
  category?: Category
  evidence: string[]
}

export function buildRecommendations(ctx: InsightContext): Recommendation[] {
  const { transactions, recurring, today, settings } = ctx
  const out: Recommendation[] = []
  if (transactions.length < 10) return out

  const series = monthlySeries(transactions)
  const thisMonth = monthKey(today)
  const completed = series.filter((s) => s.month < thisMonth)
  if (completed.length < 2) return out

  const recent = completed.slice(-3)
  const avgIncome = recent.reduce((a, s) => a + s.incomePaise, 0) / recent.length
  const avgExpense = recent.reduce((a, s) => a + s.expensePaise, 0) / recent.length
  const avgSavings = avgIncome - avgExpense

  // Average monthly spend per category over the completed months.
  const catAvg = new Map<Category, number>()
  for (const s of recent) {
    const monthTxns = transactions.filter((t) => monthKey(t.date) === s.month)
    for (const c of categoryBreakdown(monthTxns)) {
      catAvg.set(c.category, (catAvg.get(c.category) ?? 0) + c.paise / recent.length)
    }
  }

  // 1. Discretionary trim - the classic, quantified from real averages.
  const discretionary: Category[] = ['Shopping', 'Entertainment', 'Food & Dining']
  for (const cat of discretionary) {
    const avg = catAvg.get(cat) ?? 0
    if (avg < 100000) continue // under Rs 1,000/month is not worth a recommendation
    const share = avgExpense > 0 ? avg / avgExpense : 0
    const trim = share > 0.2 ? 0.2 : 0.12
    out.push({
      key: `trim-${cat}`,
      title: `Trim ${cat.toLowerCase()} by ${Math.round(trim * 100)}%`,
      rationale: `You spend about ${(avg / 100).toFixed(0)} per month on ${cat.toLowerCase()}, which is ${pct(share)} of your average monthly expenses. A ${Math.round(trim * 100)}% reduction is usually achievable without changing your routine much.`,
      estimatedSavingPaise: Math.round(avg * trim),
      difficulty: trim > 0.15 ? 'moderate' : 'easy',
      category: cat,
      evidence: recent.map((s) => {
        const monthTxns = transactions.filter((t) => monthKey(t.date) === s.month)
        const c = categoryBreakdown(monthTxns).find((x) => x.category === cat)
        return `${monthLabel(s.month)}: ${((c?.paise ?? 0) / 100).toFixed(0)} over ${c?.count ?? 0} transactions`
      }),
    })
  }

  // 2. Subscription audit
  const subs = recurring.filter((r) => r.status !== 'dismissed' && r.category === 'Subscriptions')
  if (subs.length >= 2) {
    const subTotal = subs.reduce((a, r) => a + monthlyCostPaise(r), 0)
    // Assume the cheapest one is the easiest to drop - a transparent assumption.
    const cheapest = [...subs].sort((a, b) => monthlyCostPaise(a) - monthlyCostPaise(b))[0]
    out.push({
      key: 'audit-subscriptions',
      title: `Audit ${subs.length} recurring subscriptions`,
      rationale: `Detected subscriptions cost about ${(subTotal / 100).toFixed(0)} per month. Cancelling even one unused service (for example ${cheapest.name} at ${(monthlyCostPaise(cheapest) / 100).toFixed(0)}/month) is a permanent saving with no lifestyle change.`,
      estimatedSavingPaise: monthlyCostPaise(cheapest),
      difficulty: 'easy',
      evidence: subs.map((r) => `${r.name}: ${(r.averagePaise / 100).toFixed(0)} ${r.frequency}, ${r.occurrences} charges, last ${r.lastDate}`),
    })
  }

  // 3. Rising categories
  const prevMonth = monthKey(addMonths(`${thisMonth}-01`, -1))
  const prevPrev = monthKey(addMonths(`${thisMonth}-01`, -2))
  for (const d of categoryDeltas(transactions, prevMonth, prevPrev)) {
    if (d.deltaRatio === null || d.deltaRatio < 0.25 || d.currentPaise < 150000) continue
    out.push({
      key: `rising-${d.category}`,
      title: `${d.category} spending is rising`,
      rationale: `${d.category} went from ${(d.previousPaise / 100).toFixed(0)} in ${monthLabel(prevPrev)} to ${(d.currentPaise / 100).toFixed(0)} in ${monthLabel(prevMonth)}, a ${pct(d.deltaRatio)} increase. Returning to the earlier level would recover the difference.`,
      estimatedSavingPaise: d.deltaPaise,
      difficulty: 'moderate',
      category: d.category,
      evidence: [
        `${monthLabel(prevPrev)}: ${(d.previousPaise / 100).toFixed(0)}`,
        `${monthLabel(prevMonth)}: ${(d.currentPaise / 100).toFixed(0)}`,
      ],
    })
  }

  // 4. Savings goal gap
  const goal = settings.monthlySavingsGoalPaise
  if (goal > 0 && avgSavings < goal) {
    const gap = goal - avgSavings
    out.push({
      key: 'savings-goal-gap',
      title: `You are ${(gap / 100).toFixed(0)} short of your monthly savings goal`,
      rationale: `Your average monthly saving over the last ${recent.length} months is ${(avgSavings / 100).toFixed(0)} against a goal of ${(goal / 100).toFixed(0)}. Combining the recommendations above covers part of this gap.`,
      estimatedSavingPaise: gap,
      difficulty: gap > avgExpense * 0.15 ? 'ambitious' : 'moderate',
      evidence: recent.map((s) => `${monthLabel(s.month)}: saved ${(s.savingsPaise / 100).toFixed(0)}`),
    })
  }

  // 5. Food budget suggestion
  const food = catAvg.get('Food & Dining') ?? 0
  const groceries = catAvg.get('Groceries') ?? 0
  if (food > groceries && food > 300000) {
    out.push({
      key: 'food-vs-groceries',
      title: 'Set a monthly eating-out budget',
      rationale: `You spend about ${(food / 100).toFixed(0)} per month on food & dining versus ${(groceries / 100).toFixed(0)} on groceries. Shifting a quarter of restaurant spend to home cooking typically saves most of that amount.`,
      estimatedSavingPaise: Math.round(food * 0.25 * 0.6),
      difficulty: 'moderate',
      category: 'Food & Dining',
      evidence: [
        `Food & Dining average: ${(food / 100).toFixed(0)}/month`,
        `Groceries average: ${(groceries / 100).toFixed(0)}/month`,
      ],
    })
  }

  return out.sort((a, b) => b.estimatedSavingPaise - a.estimatedSavingPaise)
}
