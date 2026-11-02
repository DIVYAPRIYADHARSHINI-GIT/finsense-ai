/**
 * Dashboard - the financial overview.
 *
 * Every metric and every chart is computed from the live transaction store via
 * the pure functions in lib/analytics.ts. There are no static demonstration
 * numbers on this page; when there is no data, each panel says so explicitly.
 */

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Banknote,
  CalendarClock,
  Database,
  Lightbulb,
  PiggyBank,
  Receipt,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ProgressBar, SectionTitle, Skeleton } from '../components/ui'
import { MetricCard } from '../components/MetricCard'
import { DateFilterBar, defaultRangeFilter, resolveRange, type RangeFilter } from '../components/DateFilterBar'
import {
  ActualVsPredictedChart,
  CategoryBarChart,
  CategoryDonut,
  IncomeExpenseChart,
  TrendAreaChart,
} from '../components/charts'
import { useAppStore } from '../store/AppStore'
import {
  budgetStatus,
  categoryBreakdown,
  computeTotals,
  filterByDate,
  monthlySeries,
  weeklySeries,
} from '../lib/analytics'
import { buildInsights } from '../lib/insights'
import { upcomingPayments } from '../lib/recurring'
import { addMonths, formatDate, monthKey, monthLabel } from '../lib/dates'
import { formatMoney, formatPercent } from '../lib/money'
import type { PageProps } from './types'

export function Dashboard({ ml, runForecast, runAnomalyScan, navigate, visibleAnomalies }: PageProps) {
  const store = useAppStore()
  const { transactions, settings, today, recurring, budgets, ready } = store
  const [filter, setFilter] = useState<RangeFilter>(() => defaultRangeFilter(today))

  const range = useMemo(() => resolveRange(filter), [filter])
  const scoped = useMemo(() => filterByDate(transactions, range), [transactions, range])

  const totals = useMemo(() => computeTotals(scoped, range), [scoped, range])
  const allTotals = useMemo(() => computeTotals(transactions), [transactions])
  const series = useMemo(() => monthlySeries(transactions), [transactions])
  const breakdown = useMemo(() => categoryBreakdown(scoped), [scoped])
  const weekly = useMemo(() => weeklySeries(transactions, 12), [transactions])

  const thisMonth = monthKey(today)
  const prevMonth = monthKey(addMonths(`${thisMonth}-01`, -1))
  const currentPoint = series.find((s) => s.month === thisMonth)
  const prevPoint = series.find((s) => s.month === prevMonth)

  const expenseDelta =
    currentPoint && prevPoint && prevPoint.expensePaise > 0
      ? (currentPoint.expensePaise - prevPoint.expensePaise) / prevPoint.expensePaise
      : null
  const incomeDelta =
    currentPoint && prevPoint && prevPoint.incomePaise > 0
      ? (currentPoint.incomePaise - prevPoint.incomePaise) / prevPoint.incomePaise
      : null

  const topCategory = breakdown[0]
  const forecast = ml.forecast
  const forecastPaise = forecast?.ok ? Math.round((forecast.nextMonthPrediction ?? 0) * 100) : null

  const insights = useMemo(
    () =>
      buildInsights({
        transactions,
        recurring,
        budgets,
        settings,
        today,
        forecastPaise,
        forecastMonth: forecast?.nextMonth ?? null,
        anomalyCount: visibleAnomalies.length,
      }).filter((i) => !store.insightFeedback.some((f) => f.key === i.key && f.state === 'dismissed')),
    [transactions, recurring, budgets, settings, today, forecastPaise, forecast?.nextMonth, visibleAnomalies.length, store.insightFeedback],
  )

  const budgetRows = useMemo(() => budgetStatus(transactions, budgets, thisMonth, today), [transactions, budgets, thisMonth, today])
  const upcoming = useMemo(() => upcomingPayments(recurring, today, 30), [recurring, today])
  const recent = useMemo(() => transactions.slice(0, 8), [transactions])

  // Actual vs predicted: the backtest months plus the next-month projection.
  const actualVsPredicted = useMemo(() => {
    if (!forecast?.ok) return []
    const rows: { month: string; actual: number | null; predicted: number | null }[] = (
      forecast.backtest ?? []
    ).map((b) => ({
      month: monthLabel(b.month).replace(' ', " '").slice(0, 7),
      actual: b.actual as number | null,
      predicted: b.predicted as number | null,
    }))
    if (forecast.nextMonth && forecast.nextMonthPrediction !== undefined) {
      rows.push({
        month: monthLabel(forecast.nextMonth).replace(' ', " '").slice(0, 7),
        actual: null,
        predicted: forecast.nextMonthPrediction,
      })
    }
    return rows
  }, [forecast])

  if (!ready) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="p-[18px]" as="div">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3 h-3 w-20" />
          </Card>
        ))}
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Database}
          title="No transactions yet"
          description="Load the fictional sample dataset to explore every feature, or import your own bank/UPI CSV. Everything stays in this browser."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="primary"
                icon={Sparkles}
                onClick={async () => {
                  const n = await store.loadSampleData()
                  if (n) store.pushToast('success', `Loaded ${n} fictional sample transactions.`)
                }}
              >
                Load sample data
              </Button>
              <Button variant="secondary" icon={Receipt} onClick={() => navigate('transactions')}>
                Import a CSV
              </Button>
            </div>
          }
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- filter ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateFilterBar filter={filter} onChange={setFilter} transactions={transactions} />
        <p className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
          Showing <span className="tnum font-semibold">{totals.transactionCount}</span> transactions - {range.label}
        </p>
      </div>

      {/* ---- metrics ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Income"
          value={formatMoney(totals.incomePaise, settings.currency)}
          icon={Banknote}
          tone="success"
          delta={filter.mode === 'month' && filter.month === thisMonth ? incomeDelta : null}
          deltaLabel={filter.mode === 'month' && filter.month === thisMonth ? 'vs last month' : range.label}
          help="Sum of every transaction marked as Income within the selected period."
        />
        <MetricCard
          label="Total Expenses"
          value={formatMoney(totals.expensePaise, settings.currency)}
          icon={Receipt}
          tone="accent"
          delta={filter.mode === 'month' && filter.month === thisMonth ? expenseDelta : null}
          deltaLabel={filter.mode === 'month' && filter.month === thisMonth ? 'vs last month' : range.label}
          invertDelta
          help="Sum of every transaction marked as Expense within the selected period."
        />
        <MetricCard
          label="Current Balance"
          value={formatMoney(allTotals.balancePaise, settings.currency)}
          icon={Wallet}
          tone={allTotals.balancePaise >= 0 ? 'neutral' : 'danger'}
          sublabel="Income minus expenses, all time"
          help="All recorded income minus all recorded expenses across your entire history, not just this period."
        />
        <MetricCard
          label="Total Savings"
          value={formatMoney(totals.savingsPaise, settings.currency)}
          icon={PiggyBank}
          tone="success"
          sublabel={`${range.label} net surplus`}
          help="Income minus expenses for the selected period, floored at zero."
        />
        <MetricCard
          label="Monthly Savings Rate"
          value={formatPercent(totals.savingsRate)}
          icon={totals.savingsRate >= 0.2 ? TrendingUp : TrendingDown}
          tone={totals.savingsRate >= 0.2 ? 'success' : totals.savingsRate > 0 ? 'warning' : 'danger'}
          sublabel={totals.savingsRate >= 0.2 ? 'At or above the common 20% guideline' : 'Below the common 20% guideline'}
          help="(Income - Expenses) / Income for the selected period. A guideline, not financial advice."
        />
        <MetricCard
          label="Average Daily Spending"
          value={formatMoney(totals.avgDailySpendPaise, settings.currency)}
          icon={CalendarClock}
          sublabel={`Across ${totals.dayCount} day${totals.dayCount === 1 ? '' : 's'}`}
          help="Total expenses divided by the number of days actually covered by the selected period."
        />
        <MetricCard
          label="Highest Spending Category"
          value={topCategory ? topCategory.category : '--'}
          icon={TrendingUp}
          tone="warning"
          sublabel={
            topCategory
              ? `${formatMoney(topCategory.paise, settings.currency)} - ${formatPercent(topCategory.share, 0)} of expenses`
              : 'No expenses in this period'
          }
          help="The expense category with the largest total within the selected period."
        />
        <MetricCard
          label="Predicted Next-Month Expenses"
          value={forecastPaise !== null ? formatMoney(forecastPaise, settings.currency) : forecast?.needsMoreData ? 'Need more data' : '--'}
          icon={Sparkles}
          tone="accent"
          loading={ml.forecasting}
          sublabel={
            forecast?.ok
              ? `${forecast.bestModel} - ${formatMoney(Math.round((forecast.lower ?? 0) * 100), settings.currency, { compact: true })} to ${formatMoney(Math.round((forecast.upper ?? 0) * 100), settings.currency, { compact: true })}`
              : forecast?.needsMoreData
                ? `${forecast.monthsAvailable}/${forecast.monthsRequired} months of history`
                : 'Run the forecast model'
          }
          help="Produced by the scikit-learn model selected on the Expense Forecast page, with its empirical uncertainty range."
        />
      </div>

      {!forecast && !ml.forecasting ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
          <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            The forecasting and anomaly models have not been run for this dataset yet.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void runAnomalyScan()} loading={ml.scanning}>
              Scan anomalies
            </Button>
            <Button size="sm" variant="primary" onClick={() => void runForecast()} loading={ml.forecasting}>
              Run forecast
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ---- charts row 1 ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly Income vs Expenses" description="Every complete month on record" icon={Banknote} />
          <div className="px-2 py-3">
            <IncomeExpenseChart data={series} currency={settings.currency} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Expense Category Breakdown"
            description={`${breakdown.length} categories - ${range.label}`}
            icon={Receipt}
          />
          <div className="px-2 py-3">
            <CategoryDonut data={breakdown} currency={settings.currency} />
          </div>
        </Card>
      </div>

      {/* ---- charts row 2 ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Weekly Spending Trends" description="Last 12 ISO weeks with activity" icon={CalendarClock} />
          <div className="px-2 py-3">
            <TrendAreaChart
              data={weekly as unknown as Record<string, unknown>[]}
              dataKey="expensePaise"
              name="Weekly spend"
              currency={settings.currency}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Monthly Spending History" description="Expense total per month" icon={TrendingUp} />
          <div className="px-2 py-3">
            <TrendAreaChart
              data={series as unknown as Record<string, unknown>[]}
              dataKey="expensePaise"
              name="Monthly spend"
              currency={settings.currency}
              color="var(--warning)"
            />
          </div>
        </Card>
      </div>

      {/* ---- charts row 3 ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Savings Growth" description="Cumulative income minus expenses" icon={PiggyBank} />
          <div className="px-2 py-3">
            <TrendAreaChart
              data={series as unknown as Record<string, unknown>[]}
              dataKey="cumulativeSavingsPaise"
              name="Cumulative savings"
              currency={settings.currency}
              color="var(--success)"
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Predicted vs Actual Expenses"
            description={forecast?.ok ? `Walk-forward backtest of ${forecast.bestModel}` : 'Run the forecast to populate'}
            icon={Sparkles}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('forecast')}>
                Details
                <ArrowRight size={13} aria-hidden />
              </Button>
            }
          />
          <div className="px-2 py-3">
            <ActualVsPredictedChart data={actualVsPredicted} currency={settings.currency} />
          </div>
        </Card>
      </div>

      {/* ---- top categories ---- */}
      <Card>
        <CardHeader title="Top Spending Categories" description={`Ranked by total for ${range.label}`} icon={TrendingUp} />
        <div className="px-2 py-3">
          <CategoryBarChart data={breakdown.slice(0, 8)} currency={settings.currency} />
        </div>
      </Card>

      {/* ---- insights + budget + upcoming ---- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="AI-Generated Financial Insights"
            description="Computed from your transactions - no language model involved"
            icon={Lightbulb}
            action={
              <Button size="sm" variant="ghost" onClick={() => navigate('insights')}>
                All insights
                <ArrowRight size={13} aria-hidden />
              </Button>
            }
          />
          {insights.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="No insights yet"
              description="Insights appear once there are at least two months of transactions to compare."
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {insights.slice(0, 5).map((i) => (
                <li key={i.key} className="flex items-start gap-3 px-5 py-3.5">
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{
                      background:
                        i.tone === 'critical'
                          ? 'var(--danger)'
                          : i.tone === 'warning'
                            ? 'var(--warning)'
                            : i.tone === 'positive'
                              ? 'var(--success)'
                              : 'var(--accent)',
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>
                      {i.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      {i.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Budget Progress" description={monthLabel(thisMonth)} icon={PiggyBank} />
            {budgetRows.length === 0 ? (
              <EmptyState
                icon={PiggyBank}
                title="No budgets set"
                description="Set category limits to track utilisation."
                action={
                  <Button size="sm" variant="secondary" onClick={() => navigate('budgets')}>
                    Set budgets
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-3.5 px-5 py-4">
                {budgetRows.slice(0, 5).map((b) => (
                  <li key={b.category}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {b.category === '__total__' ? 'Total monthly' : b.category}
                      </span>
                      <span className="tnum shrink-0 text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                        {formatMoney(b.spentPaise, settings.currency, { compact: true })} /{' '}
                        {formatMoney(b.limitPaise, settings.currency, { compact: true })}
                      </span>
                    </div>
                    <ProgressBar
                      value={b.utilisation}
                      tone={b.state === 'exceeded' ? 'danger' : b.state === 'warning' ? 'warning' : 'success'}
                      marker={b.limitPaise > 0 ? b.pacePaise / b.limitPaise : undefined}
                      label={`${b.category} budget utilisation`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Upcoming Recurring Payments" description="Next 30 days" icon={CalendarClock} />
            {upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled"
                description="No recurring charges are projected in the next 30 days."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {upcoming.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                        {p.name}
                      </p>
                      <p className="text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                        {p.daysUntil === 0 ? 'Due today' : `in ${p.daysUntil} day${p.daysUntil === 1 ? '' : 's'}`} -{' '}
                        {formatDate(p.nextDate, settings.dateFormat)}
                      </p>
                    </div>
                    <span className="tnum shrink-0 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatMoney(p.averagePaise, settings.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ---- recent transactions ---- */}
      <Card>
        <CardHeader
          title="Recent Transactions"
          description="Most recent activity across all periods"
          icon={Receipt}
          action={
            <Button size="sm" variant="ghost" onClick={() => navigate('transactions')}>
              View all
              <ArrowRight size={13} aria-hidden />
            </Button>
          }
        />
        <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {recent.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  {t.merchant || t.description || 'Untitled transaction'}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                  <span>{formatDate(t.date, settings.dateFormat)}</span>
                  <span aria-hidden>-</span>
                  <span>{t.category}</span>
                  {t.categorySource === 'ml' ? (
                    <Badge tone={t.mlConfidence !== undefined && t.mlConfidence < 0.55 ? 'warning' : 'accent'}>
                      {t.mlConfidence !== undefined && t.mlConfidence < 0.55
                        ? 'Uncertain'
                        : `ML ${Math.round((t.mlConfidence ?? 0) * 100)}%`}
                    </Badge>
                  ) : null}
                </p>
              </div>
              <span
                className="tnum shrink-0 text-[14px] font-semibold"
                style={{ color: t.type === 'income' ? 'var(--success-ink)' : 'var(--ink)' }}
              >
                {t.type === 'income' ? '+' : '-'}
                {formatMoney(t.amountPaise, settings.currency)}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <SectionTitle>Privacy</SectionTitle>
      <Card className="px-5 py-4" as="div">
        <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          FinSense AI never connects to a bank and never asks for passwords, UPI PINs, OTPs or card details. All
          transactions live in this browser's IndexedDB, and the machine learning runs locally in WebAssembly Python.
        </p>
      </Card>
    </div>
  )
}
