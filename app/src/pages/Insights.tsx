/**
 * AI Insights - statistically derived findings with their supporting evidence.
 *
 * Also hosts the classification model report (ML Module 1) because that is the
 * natural place to inspect accuracy and the confusion matrix.
 */

import { useMemo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  Lightbulb,
  Sparkles,
  ThumbsUp,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, ProgressBar, SectionTitle, Skeleton, cx } from '../components/ui'
import { useAppStore } from '../store/AppStore'
import { buildInsights, type Insight } from '../lib/insights'
import { formatPercent } from '../lib/money'
import type { PageProps } from './types'

function InsightRow({
  insight,
  feedback,
  onFeedback,
}: {
  insight: Insight
  feedback?: 'dismissed' | 'useful'
  onFeedback: (state: 'dismissed' | 'useful' | null) => void
}) {
  const [open, setOpen] = useState(false)
  const toneColor = {
    positive: 'var(--success)',
    neutral: 'var(--accent)',
    warning: 'var(--warning)',
    critical: 'var(--danger)',
  }[insight.tone]

  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: toneColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--ink)' }}>
              {insight.title}
            </p>
            {insight.category ? <Badge tone="neutral">{insight.category}</Badge> : null}
            {feedback === 'useful' ? (
              <Badge tone="success" icon={ThumbsUp}>
                Marked useful
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {insight.detail}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 text-[12px] font-semibold"
              style={{ color: 'var(--accent-ink)' }}
            >
              <ChevronDown size={13} className={cx('transition-transform', open && 'rotate-180')} aria-hidden />
              Why this?
            </button>
            <span className="h-3 w-px" style={{ background: 'var(--line)' }} aria-hidden />
            <button
              type="button"
              onClick={() => onFeedback(feedback === 'useful' ? null : 'useful')}
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: feedback === 'useful' ? 'var(--success-ink)' : 'var(--ink-subtle)' }}
            >
              <ThumbsUp size={13} aria-hidden />
              Useful
            </button>
            <button
              type="button"
              onClick={() => onFeedback('dismissed')}
              className="inline-flex items-center gap-1 text-[12px]"
              style={{ color: 'var(--ink-subtle)' }}
            >
              <X size={13} aria-hidden />
              Dismiss
            </button>
          </div>

          {open ? (
            <div className="mt-3 rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken)' }}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
                Supporting data
              </p>
              <ul className="space-y-1">
                {insight.evidence.map((e, i) => (
                  <li key={i} className="tnum text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function Insights({ ml, trainClassifier, visibleAnomalies, navigate }: PageProps) {
  const store = useAppStore()
  const { transactions, recurring, budgets, settings, today, insightFeedback } = store
  const [showDismissed, setShowDismissed] = useState(false)

  const forecastPaise = ml.forecast?.ok ? Math.round((ml.forecast.nextMonthPrediction ?? 0) * 100) : null

  const all = useMemo(
    () =>
      buildInsights({
        transactions,
        recurring,
        budgets,
        settings,
        today,
        forecastPaise,
        forecastMonth: ml.forecast?.nextMonth ?? null,
        anomalyCount: visibleAnomalies.length,
      }),
    [transactions, recurring, budgets, settings, today, forecastPaise, ml.forecast?.nextMonth, visibleAnomalies.length],
  )

  const feedbackMap = useMemo(() => new Map(insightFeedback.map((f) => [f.key, f.state])), [insightFeedback])
  const active = all.filter((i) => feedbackMap.get(i.key) !== 'dismissed')
  const dismissed = all.filter((i) => feedbackMap.get(i.key) === 'dismissed')

  const clf = ml.classifier

  return (
    <div className="space-y-5">
      {/* ---- insights ---- */}
      <Card>
        <CardHeader
          title={`${active.length} insight${active.length === 1 ? '' : 's'}`}
          description="Every statement below is computed from your stored transactions - no language model is used"
          icon={Lightbulb}
        />
        {active.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title={transactions.length ? 'No insights to show' : 'No transactions yet'}
            description={
              transactions.length
                ? 'Insights compare the current month against previous months, so at least two months of data are needed.'
                : 'Load the sample dataset or import a CSV to generate insights.'
            }
            action={
              !transactions.length ? (
                <Button variant="primary" onClick={() => navigate('transactions')}>
                  Add transactions
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {active.map((i) => (
              <InsightRow
                key={i.key}
                insight={i}
                feedback={feedbackMap.get(i.key)}
                onFeedback={(state) => void store.setInsightFeedback(i.key, state)}
              />
            ))}
          </ul>
        )}
      </Card>

      {dismissed.length > 0 ? (
        <Card>
          <CardHeader
            title={`${dismissed.length} dismissed insight${dismissed.length === 1 ? '' : 's'}`}
            icon={Trash2}
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowDismissed((v) => !v)}>
                {showDismissed ? 'Hide' : 'Show'}
              </Button>
            }
          />
          {showDismissed ? (
            <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {dismissed.map((i) => (
                <li key={i.key} className="flex items-center justify-between gap-3 px-5 py-3">
                  <p className="min-w-0 truncate text-[13px]" style={{ color: 'var(--ink-subtle)' }}>
                    {i.title}
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => void store.setInsightFeedback(i.key, null)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* ---- classifier report ---- */}
      <SectionTitle>Expense classification model</SectionTitle>
      <Card>
        <CardHeader
          title="Automatic Expense Classification"
          description="TF-IDF text features with Naive Bayes, Logistic Regression and Random Forest compared on your own data"
          icon={Brain}
          action={
            <Button size="sm" variant="primary" icon={Sparkles} loading={ml.trainingClassifier} onClick={() => void trainClassifier()}>
              {clf?.ok ? 'Retrain' : 'Train model'}
            </Button>
          }
        />

        {ml.trainingClassifier && !clf ? (
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : null}

        {clf && !clf.ok ? (
          <EmptyState
            icon={Brain}
            title="Classifier not trained"
            description={clf.message ?? 'Not enough categorised transactions.'}
          />
        ) : null}

        {!clf && !ml.trainingClassifier ? (
          <EmptyState
            icon={Brain}
            title="No classification model trained yet"
            description="Training compares three scikit-learn classifiers by cross-validation and keeps the best one. It runs entirely in this browser."
            action={
              <Button variant="primary" icon={Sparkles} onClick={() => void trainClassifier()}>
                Train classifier
              </Button>
            }
          />
        ) : null}

        {clf?.ok ? (
          <div className="space-y-5 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Selected model', value: clf.bestModel ?? '--', tone: 'accent' as const },
                { label: 'Holdout accuracy', value: formatPercent(clf.testAccuracy ?? 0), tone: 'success' as const },
                { label: 'Macro F1', value: (clf.macroF1 ?? 0).toFixed(3), tone: 'neutral' as const },
                { label: 'Training samples', value: `${clf.trainSize} / ${clf.testSize}`, tone: 'neutral' as const },
              ].map((s) => (
                <div key={s.label} className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken)' }}>
                  <p className="text-[11.5px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
                    {s.label}
                  </p>
                  <p
                    className="tnum mt-1 text-[16px] font-semibold leading-tight"
                    style={{ color: s.tone === 'success' ? 'var(--success-ink)' : s.tone === 'accent' ? 'var(--accent-ink)' : 'var(--ink)' }}
                  >
                    {s.value}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
                Model comparison
              </p>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                      <th className="p-3 text-left font-semibold">Model</th>
                      <th className="p-3 text-right font-semibold">CV accuracy</th>
                      <th className="p-3 text-right font-semibold">Holdout accuracy</th>
                      <th className="p-3 text-right font-semibold">Macro F1</th>
                      <th className="p-3 text-right font-semibold">Selected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(clf.comparison ?? []).map((c) => (
                      <tr key={c.model} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="p-3 font-medium" style={{ color: 'var(--ink)' }}>
                          {c.model}
                        </td>
                        <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                          {c.error ? '--' : c.cvAccuracy === null ? 'n/a' : `${((c.cvAccuracy ?? 0) * 100).toFixed(2)}% ±${((c.cvStd ?? 0) * 100).toFixed(1)}`}
                        </td>
                        <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                          {c.error ? '--' : `${(c.testAccuracy * 100).toFixed(2)}%`}
                        </td>
                        <td className="tnum p-3 text-right" style={{ color: 'var(--ink-muted)' }}>
                          {c.error ? '--' : c.macroF1.toFixed(3)}
                        </td>
                        <td className="p-3 text-right">
                          {c.model === clf.bestModel ? <Badge tone="success">Selected</Badge> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {clf.confusionMatrix ? (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
                  Confusion matrix - holdout set
                </p>
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                  <table className="text-[11.5px]">
                    <thead>
                      <tr style={{ background: 'var(--surface-sunken)' }}>
                        <th className="sticky left-0 p-2 text-left font-semibold" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                          Actual \ Predicted
                        </th>
                        {clf.confusionMatrix.labels.map((l) => (
                          <th key={l} className="min-w-[46px] p-2 text-center font-semibold" style={{ color: 'var(--ink-muted)' }} title={l}>
                            {l.slice(0, 4)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {clf.confusionMatrix.matrix.map((row, ri) => {
                        const rowTotal = row.reduce((a, b) => a + b, 0)
                        return (
                          <tr key={ri} className="border-t" style={{ borderColor: 'var(--line)' }}>
                            <th
                              className="sticky left-0 whitespace-nowrap p-2 text-left font-medium"
                              style={{ background: 'var(--surface)', color: 'var(--ink)' }}
                            >
                              {clf.confusionMatrix!.labels[ri]}
                            </th>
                            {row.map((v, ci) => (
                              <td
                                key={ci}
                                className="tnum p-2 text-center"
                                style={{
                                  background:
                                    v === 0
                                      ? undefined
                                      : ri === ci
                                        ? `color-mix(in srgb, var(--success) ${Math.min(70, (v / Math.max(1, rowTotal)) * 70)}%, transparent)`
                                        : `color-mix(in srgb, var(--danger) ${Math.min(70, (v / Math.max(1, rowTotal)) * 70)}%, transparent)`,
                                  color: 'var(--ink)',
                                  fontWeight: ri === ci && v > 0 ? 600 : 400,
                                }}
                              >
                                {v || ''}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
                  Green cells on the diagonal are correct predictions; red cells off the diagonal are mistakes. Only
                  categories present in the holdout split appear here.
                </p>
              </div>
            ) : null}

            <div className="rounded-lg px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
              <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--accent-ink)' }}>
                Predictions below {formatPercent(clf.lowConfidenceThreshold ?? 0.55, 0)} confidence are labelled
                "Uncertain - Review Category" rather than applied silently. Correcting a category on the Transactions
                page turns that row into ground-truth training data for the next retrain.
              </p>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ---- quick category movement ---- */}
      {active.some((i) => i.category) ? (
        <Card>
          <CardHeader title="Category movement" description="Largest month-over-month changes behind the insights above" icon={TrendingUp} />
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {active
              .filter((i) => i.category && i.key.startsWith('cat-delta'))
              .slice(0, 6)
              .map((i) => (
                <li key={i.key} className="flex items-center gap-3 px-5 py-3">
                  {i.tone === 'positive' ? (
                    <TrendingDown size={15} style={{ color: 'var(--success)' }} aria-hidden />
                  ) : (
                    <TrendingUp size={15} style={{ color: 'var(--warning)' }} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    {i.title}
                  </span>
                  <Check size={14} style={{ color: 'var(--ink-subtle)' }} aria-hidden />
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      <Card className="px-5 py-4" as="div">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
          Classifier coverage
        </p>
        <ProgressBar
          value={
            transactions.length
              ? transactions.filter((t) => t.categorySource !== 'ml' || (t.mlConfidence ?? 0) >= 0.55).length /
                transactions.length
              : 0
          }
          tone="accent"
          label="Share of transactions with a confident or user-set category"
        />
        <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
          {transactions.filter((t) => t.categorySource === 'ml' && (t.mlConfidence ?? 1) < 0.55).length} transaction(s)
          still need a category review.
        </p>
      </Card>
    </div>
  )
}
