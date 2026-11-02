/**
 * Reports - eight report types with CSV, PDF and JSON export.
 *
 * Reports are generated from the same analytics functions the dashboard uses,
 * so an exported figure can never disagree with the on-screen figure.
 */

import { useMemo, useState } from 'react'
import { BarChart3, Download, FileJson, FileText, Table2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, SectionTitle } from '../components/ui'
import { DateFilterBar, defaultRangeFilter, resolveRange, type RangeFilter } from '../components/DateFilterBar'
import { CategoryBarChart, IncomeExpenseChart, TrendAreaChart } from '../components/charts'
import { useAppStore } from '../store/AppStore'
import {
  categoryBreakdown,
  computeTotals,
  dayOfWeekProfile,
  filterByDate,
  monthlySeries,
} from '../lib/analytics'
import { monthlyCostPaise, recurringMonthlyTotal } from '../lib/recurring'
import { buildPdf, type PdfSection } from '../lib/pdf'
import { csvDownloadBody, toCSV } from '../lib/csv'
import { serialiseBackup } from '../lib/storage'
import { formatDate, monthLabel, todayISO } from '../lib/dates'
import { formatMoney, formatPercent, toMajor } from '../lib/money'
import type { PageProps } from './types'

type ReportId =
  | 'monthly'
  | 'annual'
  | 'income-expense'
  | 'category'
  | 'savings'
  | 'recurring'
  | 'anomaly'
  | 'forecast'

const REPORTS: { id: ReportId; label: string; description: string }[] = [
  { id: 'monthly', label: 'Monthly Expense Report', description: 'Every expense in the period with category and method' },
  { id: 'annual', label: 'Annual Expense Report', description: 'Month-by-month totals across the selected year' },
  { id: 'income-expense', label: 'Income vs Expense Report', description: 'Monthly income, expenses, net and savings rate' },
  { id: 'category', label: 'Category-wise Spending Report', description: 'Totals, share and transaction counts per category' },
  { id: 'savings', label: 'Savings Report', description: 'Savings per month with cumulative growth' },
  { id: 'recurring', label: 'Recurring Payments Report', description: 'Detected subscriptions, cadence and monthly cost' },
  { id: 'anomaly', label: 'Anomaly Detection Report', description: 'Flagged transactions with scores and reasons' },
  { id: 'forecast', label: 'Forecast Report', description: 'Model comparison, metrics and next-month prediction' },
]

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Reports({ ml, visibleAnomalies, navigate }: PageProps) {
  const store = useAppStore()
  const { transactions, settings, recurring, budgets, today } = store
  const [filter, setFilter] = useState<RangeFilter>(() => ({ ...defaultRangeFilter(today), mode: 'year' }))
  const [selected, setSelected] = useState<ReportId>('monthly')

  const range = useMemo(() => resolveRange(filter), [filter])
  const scoped = useMemo(() => filterByDate(transactions, range), [transactions, range])
  const totals = useMemo(() => computeTotals(scoped, range), [scoped, range])
  const series = useMemo(() => monthlySeries(scoped), [scoped])
  const breakdown = useMemo(() => categoryBreakdown(scoped), [scoped])
  const dow = useMemo(() => dayOfWeekProfile(scoped), [scoped])

  const money = (p: number) => formatMoney(p, settings.currency)

  /** Build the rows for the selected report. Shared by CSV and PDF. */
  const buildRows = (id: ReportId): { headers: string[]; rows: (string | number)[][]; alignRight: number[] } => {
    switch (id) {
      case 'monthly':
        return {
          headers: ['Date', 'Merchant', 'Description', 'Category', 'Method', 'Type', 'Amount'],
          alignRight: [6],
          rows: scoped
            .filter((t) => t.type === 'expense')
            .map((t) => [
              formatDate(t.date, settings.dateFormat),
              t.merchant,
              t.description,
              t.category,
              t.paymentMethod,
              t.type,
              toMajor(t.amountPaise).toFixed(2),
            ]),
        }
      case 'annual':
        return {
          headers: ['Month', 'Income', 'Expenses', 'Net', 'Savings rate'],
          alignRight: [1, 2, 3, 4],
          rows: series.map((s) => [
            monthLabel(s.month),
            toMajor(s.incomePaise).toFixed(2),
            toMajor(s.expensePaise).toFixed(2),
            toMajor(s.savingsPaise).toFixed(2),
            s.incomePaise > 0 ? `${((s.savingsPaise / s.incomePaise) * 100).toFixed(1)}%` : 'n/a',
          ]),
        }
      case 'income-expense':
        return {
          headers: ['Month', 'Income', 'Expenses', 'Net', 'Cumulative'],
          alignRight: [1, 2, 3, 4],
          rows: series.map((s) => [
            monthLabel(s.month),
            toMajor(s.incomePaise).toFixed(2),
            toMajor(s.expensePaise).toFixed(2),
            toMajor(s.savingsPaise).toFixed(2),
            toMajor(s.cumulativeSavingsPaise).toFixed(2),
          ]),
        }
      case 'category':
        return {
          headers: ['Category', 'Total spent', 'Share of expenses', 'Transactions', 'Average'],
          alignRight: [1, 2, 3, 4],
          rows: breakdown.map((c) => [
            c.category,
            toMajor(c.paise).toFixed(2),
            `${(c.share * 100).toFixed(1)}%`,
            c.count,
            toMajor(Math.round(c.paise / Math.max(1, c.count))).toFixed(2),
          ]),
        }
      case 'savings':
        return {
          headers: ['Month', 'Saved', 'Cumulative savings', 'Savings rate'],
          alignRight: [1, 2, 3],
          rows: series.map((s) => [
            monthLabel(s.month),
            toMajor(s.savingsPaise).toFixed(2),
            toMajor(s.cumulativeSavingsPaise).toFixed(2),
            s.incomePaise > 0 ? `${((s.savingsPaise / s.incomePaise) * 100).toFixed(1)}%` : 'n/a',
          ]),
        }
      case 'recurring':
        return {
          headers: ['Name', 'Merchant', 'Category', 'Frequency', 'Average', 'Per month', 'Last paid', 'Next (est.)', 'Status'],
          alignRight: [4, 5],
          rows: recurring
            .filter((r) => r.status !== 'dismissed')
            .map((r) => [
              r.name,
              r.merchant,
              r.category,
              r.frequency,
              toMajor(r.averagePaise).toFixed(2),
              toMajor(monthlyCostPaise(r)).toFixed(2),
              r.lastDate,
              r.nextDate,
              r.status,
            ]),
        }
      case 'anomaly':
        return {
          headers: ['Date', 'Merchant', 'Category', 'Amount', 'Score', 'Z-score', 'Primary reason'],
          alignRight: [3, 4, 5],
          rows: visibleAnomalies.map((a) => [
            a.date,
            a.merchant,
            a.category,
            a.amount.toFixed(2),
            a.score.toFixed(3),
            a.zScore.toFixed(2),
            a.reasons[0] ?? '',
          ]),
        }
      case 'forecast':
        return {
          headers: ['Model', 'MAE', 'RMSE', 'MAPE', 'Backtest folds', 'Selected'],
          alignRight: [1, 2, 3, 4],
          rows: (ml.forecast?.metrics ?? []).map((m) => [
            m.model,
            m.mae.toFixed(2),
            m.rmse.toFixed(2),
            `${m.mape.toFixed(1)}%`,
            m.folds,
            m.model === ml.forecast?.bestModel ? 'Yes' : '',
          ]),
        }
    }
  }

  const current = buildRows(selected)
  const meta = REPORTS.find((r) => r.id === selected)!

  const exportCSV = () => {
    const csv = toCSV([
      [`FinSense AI - ${meta.label}`],
      [`Period: ${range.label}`, `Generated: ${new Date().toISOString()}`],
      [],
      current.headers,
      ...current.rows,
    ])
    downloadBlob(`finsense-${selected}-${todayISO()}.csv`, new Blob([csvDownloadBody(csv)], { type: 'text/csv;charset=utf-8' }))
    store.pushToast('success', `${meta.label} exported as CSV.`)
  }

  const exportPDF = () => {
    const sections: PdfSection[] = []

    sections.push({
      heading: 'Summary',
      keyValues: [
        ['Period', range.label],
        ['Transactions', String(totals.transactionCount)],
        ['Total income', money(totals.incomePaise)],
        ['Total expenses', money(totals.expensePaise)],
        ['Net', money(totals.balancePaise)],
        ['Savings rate', formatPercent(totals.savingsRate)],
        ['Average daily spend', money(totals.avgDailySpendPaise)],
      ],
    })

    if (selected === 'forecast' && ml.forecast?.ok) {
      sections.push({
        heading: 'Forecast',
        keyValues: [
          ['Selected model', ml.forecast.bestModel ?? '--'],
          ['Predicted month', monthLabel(ml.forecast.nextMonth ?? '')],
          ['Prediction', money(Math.round((ml.forecast.nextMonthPrediction ?? 0) * 100))],
          [
            'Uncertainty range',
            `${money(Math.round((ml.forecast.lower ?? 0) * 100))} to ${money(Math.round((ml.forecast.upper ?? 0) * 100))}`,
          ],
          ['Months of history used', String(ml.forecast.monthsUsed ?? 0)],
        ],
        paragraphs: [
          'Metrics come from a walk-forward backtest run by scikit-learn inside the browser. A forecast is an estimate from past behaviour, not a commitment about the future.',
        ],
      })
    }

    if (selected === 'anomaly') {
      sections.push({
        paragraphs: [
          'An unusual transaction is not confirmed fraud. The rows below are statistical outliers relative to your own spending history and are provided for review only.',
        ],
      })
    }

    // Size columns so the widest text fits where possible.
    const contentW = 595.28 - 96
    const weights = current.headers.map((h, i) => {
      const sample = current.rows.slice(0, 40).map((r) => String(r[i] ?? '').length)
      const maxLen = Math.max(h.length, ...(sample.length ? sample : [h.length]))
      return Math.min(26, Math.max(6, maxLen))
    })
    const weightSum = weights.reduce((a, b) => a + b, 0)
    const widths = weights.map((w) => (w / weightSum) * contentW)

    sections.push({
      heading: meta.label,
      table: { headers: current.headers, rows: current.rows, widths, alignRight: current.alignRight },
    })

    const { blob, lossy } = buildPdf({
      title: `FinSense AI - ${meta.label}`,
      subtitle: `${range.label}  |  Generated ${new Date().toLocaleString()}  |  ${current.rows.length} row(s)`,
      footerNote: 'Generated locally by FinSense AI. Fictional or personal data never leaves this browser.',
      sections,
    })
    downloadBlob(`finsense-${selected}-${todayISO()}.pdf`, blob)
    if (lossy) {
      store.pushToast(
        'warning',
        'PDF exported. Some non-Latin characters (e.g. Tamil or Hindi) cannot be drawn by the built-in PDF fonts and appear as "?". Use the CSV export to keep that text intact.',
      )
    } else {
      store.pushToast('success', `${meta.label} exported as PDF.`)
    }
  }

  const exportJSON = () => {
    const json = serialiseBackup({
      transactions,
      budgets,
      recurring,
      settings,
      ignoredAnomalyIds: store.ignoredAnomalyIds,
      insightFeedback: store.insightFeedback,
    })
    downloadBlob(`finsense-backup-${todayISO()}.json`, new Blob([json], { type: 'application/json' }))
    store.pushToast('success', 'Full JSON backup exported.')
  }

  if (!transactions.length) {
    return (
      <Card>
        <EmptyState
          icon={BarChart3}
          title="No data to report on"
          description="Add or import transactions, then come back to generate and export reports."
          action={
            <Button variant="primary" onClick={() => navigate('transactions')}>
              Add transactions
            </Button>
          }
        />
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
        <DateFilterBar filter={filter} onChange={setFilter} transactions={transactions} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Table2} onClick={exportCSV} disabled={!current.rows.length}>
            CSV
          </Button>
          <Button variant="secondary" icon={FileText} onClick={exportPDF} disabled={!current.rows.length}>
            PDF
          </Button>
          <Button variant="secondary" icon={FileJson} onClick={exportJSON}>
            JSON backup
          </Button>
        </div>
      </Card>

      {/* ---- report picker ---- */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {REPORTS.map((r) => {
          const isActive = r.id === selected
          const count = buildRows(r.id).rows.length
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r.id)}
              aria-pressed={isActive}
              className="rounded-[var(--radius-card)] border px-4 py-3 text-left transition-colors"
              style={{
                background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                borderColor: isActive ? 'var(--accent)' : 'var(--line)',
                boxShadow: isActive ? 'none' : 'var(--shadow-card)',
              }}
            >
              <p className="text-[13px] font-semibold" style={{ color: isActive ? 'var(--accent-ink)' : 'var(--ink)' }}>
                {r.label}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug" style={{ color: 'var(--ink-subtle)' }}>
                {r.description}
              </p>
              <p className="tnum mt-1.5 text-[11px] font-semibold" style={{ color: 'var(--ink-subtle)' }}>
                {count} row{count === 1 ? '' : 's'}
              </p>
            </button>
          )
        })}
      </div>

      {/* ---- summary ---- */}
      <Card>
        <CardHeader title="Period summary" description={range.label} icon={BarChart3} />
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-4" style={{ background: 'var(--line)' }}>
          {[
            ['Total income', money(totals.incomePaise)],
            ['Total expenses', money(totals.expensePaise)],
            ['Net', money(totals.balancePaise)],
            ['Savings rate', formatPercent(totals.savingsRate)],
            ['Transactions', String(totals.transactionCount)],
            ['Average daily spend', money(totals.avgDailySpendPaise)],
            ['Categories used', String(breakdown.length)],
            ['Recurring per month', money(recurringMonthlyTotal(recurring.filter((r) => r.status !== 'dismissed')))],
          ].map(([k, v]) => (
            <div key={k} className="px-5 py-3.5" style={{ background: 'var(--surface)' }}>
              <p className="text-[11.5px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
                {k}
              </p>
              <p className="tnum mt-1 text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>
                {v}
              </p>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- charts ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Income vs Expenses" description={range.label} icon={BarChart3} />
          <div className="px-2 py-3">
            <IncomeExpenseChart data={series} currency={settings.currency} height={250} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Category spending" description="Ranked totals" icon={BarChart3} />
          <div className="px-2 py-3">
            <CategoryBarChart data={breakdown.slice(0, 8)} currency={settings.currency} height={250} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Savings growth" description="Cumulative net across the period" icon={BarChart3} />
        <div className="px-2 py-3">
          <TrendAreaChart
            data={series as unknown as Record<string, unknown>[]}
            dataKey="cumulativeSavingsPaise"
            name="Cumulative savings"
            currency={settings.currency}
            color="var(--success)"
            height={230}
          />
        </div>
      </Card>

      {/* ---- table preview ---- */}
      <Card>
        <CardHeader
          title={meta.label}
          description={`${current.rows.length} row(s) - exports include every row`}
          icon={Table2}
          action={<Badge tone="accent">{range.label}</Badge>}
        />
        {current.rows.length === 0 ? (
          <EmptyState
            icon={Table2}
            title="No rows for this report"
            description={
              selected === 'forecast'
                ? 'Run the expense forecast first to populate model metrics.'
                : selected === 'anomaly'
                  ? 'Run the anomaly scan first, or no outliers were flagged.'
                  : selected === 'recurring'
                    ? 'No recurring payments have been detected yet.'
                    : 'No transactions fall inside the selected period.'
            }
            action={
              selected === 'forecast' ? (
                <Button variant="secondary" onClick={() => navigate('forecast')}>
                  Go to forecast
                </Button>
              ) : selected === 'anomaly' ? (
                <Button variant="secondary" onClick={() => navigate('anomalies')}>
                  Go to anomaly detection
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                  {current.headers.map((h, i) => (
                    <th key={h} className={`whitespace-nowrap p-3 font-semibold ${current.alignRight.includes(i) ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.rows.slice(0, 60).map((row, ri) => (
                  <tr key={ri} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`max-w-[240px] truncate p-3 ${current.alignRight.includes(ci) ? 'tnum text-right' : ''}`}
                        style={{ color: ci === 0 ? 'var(--ink)' : 'var(--ink-muted)' }}
                        title={String(cell)}
                      >
                        {String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {current.rows.length > 60 ? (
              <p className="border-t px-5 py-3 text-[12px]" style={{ borderColor: 'var(--line)', color: 'var(--ink-subtle)' }}>
                Showing the first 60 of {current.rows.length} rows. CSV and PDF exports contain all of them.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      <SectionTitle>Spending pattern</SectionTitle>
      <Card className="px-5 py-4" as="div">
        <div className="grid grid-cols-7 gap-2">
          {dow.map((d) => {
            const max = Math.max(...dow.map((x) => x.averagePaise), 1)
            return (
              <div key={d.day} className="flex flex-col items-center gap-1.5">
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${Math.max(3, (d.averagePaise / max) * 100)}%`, background: 'var(--accent)' }}
                    aria-hidden
                  />
                </div>
                <span className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {d.day}
                </span>
                <span className="tnum text-[10px]" style={{ color: 'var(--ink-subtle)' }}>
                  {formatMoney(d.averagePaise, settings.currency, { compact: true })}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
          Average spend on each day of the week across {range.label}, computed from days that had activity.
        </p>
      </Card>

      <Card className="px-5 py-4" as="div">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
          <Download size={14} className="mt-0.5 shrink-0" aria-hidden />
          Exports are generated in this browser. The PDF writer uses the built-in Helvetica fonts, which cannot render
          Tamil or Devanagari glyphs - use CSV or the JSON backup when the data contains those scripts.
        </p>
      </Card>
    </div>
  )
}
