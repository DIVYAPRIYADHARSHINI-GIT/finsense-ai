/**
 * Expense Forecast - ML Module 2.
 *
 * Shows the real walk-forward backtest: every candidate model's MAE/RMSE/MAPE
 * against a moving-average baseline, the selected model, and its empirical
 * uncertainty range. When the baseline wins, the page says so plainly rather
 * than pretending a regressor was better.
 */

import { useMemo } from 'react'
import { AlertCircle, BarChart3, CalendarClock, Clock, Gauge, Play, Sparkles, TrendingUp } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, SectionTitle, Skeleton } from '../components/ui'
import { MetricCard } from '../components/MetricCard'
import { ActualVsPredictedChart, ForecastBandChart } from '../components/charts'
import { useAppStore } from '../store/AppStore'
import { formatMoney } from '../lib/money'
import { monthLabel } from '../lib/dates'
import type { PageProps } from './types'

export function Forecast({ ml, runForecast, mlStatus }: PageProps) {
  const store = useAppStore()
  const { settings, transactions } = store
  const fc = ml.forecast
  const paise = (major: number | null | undefined) => Math.round((major ?? 0) * 100)

  const actualVsPredicted = useMemo(() => {
    if (!fc?.ok) return []
    const rows: { month: string; actual: number | null; predicted: number | null }[] = (
      fc.backtest ?? []
    ).map((b) => ({
      month: monthLabel(b.month).replace(' ', " '").slice(0, 7),
      actual: b.actual as number | null,
      predicted: b.predicted as number | null,
    }))
    if (fc.nextMonth && fc.nextMonthPrediction !== undefined) {
      rows.push({
        month: monthLabel(fc.nextMonth).replace(' ', " '").slice(0, 7),
        actual: null,
        predicted: fc.nextMonthPrediction,
      })
    }
    return rows
  }, [fc])

  const historyChart = useMemo(
    () =>
      (fc?.history ?? []).map((h) => ({
        month: monthLabel(h.month).replace(' ', " '").slice(0, 7),
        actual: h.actual,
        predicted: null as number | null,
      })),
    [fc],
  )

  const baselineWins = fc?.ok && fc.bestModel === 'Moving Average (baseline)'

  return (
    <div className="space-y-5">
      {/* ---- control bar ---- */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
            {fc?.ok
              ? `${fc.bestModel} selected from ${fc.metrics?.length ?? 0} candidates`
              : 'Forecast models have not been run on this dataset yet'}
          </p>
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
            {ml.forecasting
              ? mlStatus.message
              : fc?.ok
                ? `Trained on ${fc.monthsUsed} complete months - scikit-learn, seed ${fc.seed}`
                : 'Linear Regression, Random Forest Regressor and a moving-average baseline are compared by walk-forward backtest.'}
          </p>
        </div>
        <Button variant="primary" icon={Play} loading={ml.forecasting} onClick={() => void runForecast()}>
          {fc ? 'Re-run forecast' : 'Run forecast'}
        </Button>
      </Card>

      {/* ---- loading ---- */}
      {ml.forecasting && !fc ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-[18px]" as="div">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-28" />
            </Card>
          ))}
        </div>
      ) : null}

      {/* ---- insufficient data ---- */}
      {fc && !fc.ok && fc.needsMoreData ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title="Not enough history to forecast yet"
            description={fc.message ?? ''}
            action={
              <div className="w-full max-w-sm">
                <div className="mb-2 flex justify-between text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  <span className="tnum">
                    {fc.monthsAvailable} of {fc.monthsRequired} complete months
                  </span>
                  <span className="tnum">
                    {Math.round(((fc.monthsAvailable ?? 0) / (fc.monthsRequired ?? 4)) * 100)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-sunken)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, ((fc.monthsAvailable ?? 0) / (fc.monthsRequired ?? 4)) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
                <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
                  A forecast built on fewer months would be arithmetic dressed up as a prediction, so FinSense AI does
                  not show one. The current month is excluded because it is incomplete.
                </p>
              </div>
            }
          />
        </Card>
      ) : null}

      {/* ---- no run yet ---- */}
      {!fc && !ml.forecasting ? (
        <Card>
          <EmptyState
            icon={Sparkles}
            title="No forecast computed"
            description={
              transactions.length
                ? 'Run the forecast to backtest Linear Regression and a Random Forest Regressor against a moving-average baseline on your own history.'
                : 'Add or import transactions first, then run the forecast.'
            }
            action={
              transactions.length ? (
                <Button variant="primary" icon={Play} onClick={() => void runForecast()}>
                  Run forecast
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      {/* ---- results ---- */}
      {fc?.ok ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={`Predicted expenses - ${monthLabel(fc.nextMonth ?? '')}`}
              value={formatMoney(paise(fc.nextMonthPrediction), settings.currency)}
              icon={Sparkles}
              tone="accent"
              sublabel={`Range ${formatMoney(paise(fc.lower), settings.currency, { compact: true })} to ${formatMoney(paise(fc.upper), settings.currency, { compact: true })}`}
              help="Point prediction from the selected model. The range is a 1.96-sigma interval from its backtest residuals."
            />
            <MetricCard
              label="Expected income"
              value={fc.expectedIncome !== null && fc.expectedIncome !== undefined ? formatMoney(paise(fc.expectedIncome), settings.currency) : 'Not enough data'}
              icon={TrendingUp}
              tone="success"
              sublabel="3-month average of recorded income"
              help="Mean of your last three complete months of income. Shown only when at least two months exist."
            />
            <MetricCard
              label="Expected monthly savings"
              value={fc.expectedSavings !== null && fc.expectedSavings !== undefined ? formatMoney(paise(fc.expectedSavings), settings.currency) : '--'}
              icon={Gauge}
              tone={(fc.expectedSavings ?? 0) > 0 ? 'success' : 'danger'}
              sublabel="Expected income minus predicted expenses"
              help="Derived figure: expected income minus the model's predicted expenses."
            />
            <MetricCard
              label="Model error (MAE)"
              value={formatMoney(paise(fc.metrics?.[0]?.mae), settings.currency)}
              icon={BarChart3}
              tone="warning"
              sublabel={`${fc.metrics?.[0]?.mape.toFixed(1)}% MAPE over ${fc.metrics?.[0]?.folds} backtest folds`}
              help="Mean absolute error of the selected model measured by walk-forward backtest on your own history."
            />
          </div>

          {baselineWins ? (
            <Card className="flex items-start gap-3 px-5 py-4" as="div" >
              <AlertCircle size={17} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} aria-hidden />
              <div>
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                  The simple baseline is currently the most accurate model
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  On {fc.monthsUsed} months of history the 3-month moving average has a lower backtest MAE than both
                  regressors, so FinSense AI is using it rather than reporting a more complex model that performs worse.
                  Machine-learning regressors typically overtake the baseline once 18-24 months of history exist.
                </p>
              </div>
            </Card>
          ) : null}

          {/* ---- model comparison ---- */}
          <Card>
            <CardHeader
              title="Model comparison"
              description="Walk-forward backtest on your transactions - lower MAE and RMSE are better"
              icon={BarChart3}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                    <th className="p-3 text-left font-semibold">Model</th>
                    <th className="p-3 text-right font-semibold">MAE</th>
                    <th className="p-3 text-right font-semibold">RMSE</th>
                    <th className="p-3 text-right font-semibold">MAPE</th>
                    <th className="p-3 text-right font-semibold">Folds</th>
                    <th className="p-3 text-right font-semibold">Selected</th>
                  </tr>
                </thead>
                <tbody>
                  {(fc.metrics ?? []).map((m) => (
                    <tr key={m.model} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="p-3 font-medium" style={{ color: 'var(--ink)' }}>
                        {m.model}
                      </td>
                      <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                        {formatMoney(paise(m.mae), settings.currency)}
                      </td>
                      <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                        {formatMoney(paise(m.rmse), settings.currency)}
                      </td>
                      <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                        {m.mape.toFixed(1)}%
                      </td>
                      <td className="tnum p-3 text-right" style={{ color: 'var(--ink-subtle)' }}>
                        {m.folds}
                      </td>
                      <td className="p-3 text-right">
                        {m.model === fc.bestModel ? <Badge tone="success">Selected</Badge> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t px-5 py-3.5" style={{ borderColor: 'var(--line)' }}>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
                {fc.statsmodelsCrossCheck !== null && fc.statsmodelsCrossCheck !== undefined ? (
                  <>
                    Statsmodels Holt-Winters cross-check:{' '}
                    <span className="tnum font-semibold" style={{ color: 'var(--ink-muted)' }}>
                      {formatMoney(paise(fc.statsmodelsCrossCheck), settings.currency)}
                    </span>
                    {' - '}an independent exponential-smoothing estimate for comparison.{' '}
                  </>
                ) : null}
                Every figure is computed by scikit-learn running in this browser with random seed {fc.seed}, so repeated
                runs on the same data give identical results.
              </p>
            </div>
          </Card>

          {/* ---- charts ---- */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Actual vs Predicted Expenses" description={`Backtest of ${fc.bestModel}`} icon={BarChart3} />
              <div className="px-2 py-3">
                <ActualVsPredictedChart data={actualVsPredicted} currency={settings.currency} />
              </div>
            </Card>
            <Card>
              <CardHeader title="Historical Spending Trends" description="Complete months used for training" icon={TrendingUp} />
              <div className="px-2 py-3">
                <ActualVsPredictedChart data={historyChart} currency={settings.currency} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Next 30 Days Forecast"
              description="Daily projection shaped by your day-of-week spending pattern, with uncertainty band"
              icon={CalendarClock}
            />
            <div className="px-2 py-3">
              <ForecastBandChart data={fc.dailyForecast ?? []} currency={settings.currency} />
            </div>
          </Card>

          {/* ---- category forecast + peak days ---- */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Expected Spending by Category"
                description={`Scaled to the ${formatMoney(paise(fc.nextMonthPrediction), settings.currency)} total prediction`}
                icon={BarChart3}
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                      <th className="p-3 text-left font-semibold">Category</th>
                      <th className="p-3 text-right font-semibold">Predicted</th>
                      <th className="p-3 text-right font-semibold">Last month</th>
                      <th className="p-3 text-right font-semibold">3-month avg</th>
                      <th className="p-3 text-right font-semibold">Trend / month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fc.categoryForecast ?? []).map((c) => (
                      <tr key={c.category} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="p-3 font-medium" style={{ color: 'var(--ink)' }}>
                          {c.category}
                        </td>
                        <td className="tnum p-3 text-right font-semibold" style={{ color: 'var(--ink)' }}>
                          {formatMoney(paise(c.predicted), settings.currency)}
                        </td>
                        <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                          {formatMoney(paise(c.lastMonth), settings.currency)}
                        </td>
                        <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                          {formatMoney(paise(c.average3m), settings.currency)}
                        </td>
                        <td
                          className="tnum p-3 text-right"
                          style={{ color: c.trendPerMonth > 0 ? 'var(--danger-ink)' : 'var(--success-ink)' }}
                        >
                          {c.trendPerMonth > 0 ? '+' : ''}
                          {formatMoney(paise(c.trendPerMonth), settings.currency, { compact: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <CardHeader title="Upcoming High-Expense Periods" description="Days of the month you spend most" icon={Clock} />
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {(fc.highExpenseDays ?? []).map((d) => (
                  <li key={d.dayOfMonth} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="flex items-center gap-2.5">
                      <span
                        className="tnum flex size-8 items-center justify-center rounded-lg text-[12px] font-semibold"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
                      >
                        {d.dayOfMonth}
                      </span>
                      <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                        Day {d.dayOfMonth} of the month
                      </span>
                    </span>
                    <span className="tnum text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatMoney(paise(d.averageSpend), settings.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="border-t px-5 py-3" style={{ borderColor: 'var(--line)' }}>
                <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
                  Average spend on each calendar day across your history. Rent, EMIs and subscription renewals usually
                  explain the peaks.
                </p>
              </div>
            </Card>
          </div>

          <SectionTitle>Method</SectionTitle>
          <Card className="px-5 py-4" as="div">
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Monthly expense totals are resampled from your transactions, the incomplete current month is excluded, and
              each model is scored by walk-forward backtest: train on months 1..n, predict month n+1, step forward,
              repeat. Features are the last {(fc.monthsUsed ?? 0) >= 7 ? 3 : 2} monthly lags plus their mean, recent momentum, a
              trend index and a cyclical month encoding with a festive-season flag. The model with the lowest MAE is
              refitted on all history to produce the figure above.
            </p>
          </Card>
        </>
      ) : null}
    </div>
  )
}
