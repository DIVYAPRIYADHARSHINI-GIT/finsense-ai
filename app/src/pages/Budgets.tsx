/**
 * Budgets & Savings - limits, goals and the recommendation engine.
 *
 * Recommendations are arithmetic on the user's own averages, each shown with
 * the months it was derived from. Savings figures are labelled as estimates and
 * nothing is guaranteed.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Flag, Lightbulb, PiggyBank, Plus, Target, Trash2, TrendingDown } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, ProgressBar, Select, TextInput, cx } from '../components/ui'
import { MetricCard } from '../components/MetricCard'
import { useAppStore } from '../store/AppStore'
import { budgetStatus, computeTotals, monthlySeries } from '../lib/analytics'
import { buildRecommendations } from '../lib/insights'
import { monthKey, monthLabel } from '../lib/dates'
import { formatMoney, formatPercent, toMajor, toPaise } from '../lib/money'
import { CATEGORIES, type Budget, type Category } from '../lib/types'
import type { PageProps } from './types'

export function Budgets({ ml, navigate }: PageProps) {
  const store = useAppStore()
  const { transactions, budgets, recurring, settings, today } = store
  const [editOpen, setEditOpen] = useState(false)
  const [targetCategory, setTargetCategory] = useState<Budget['category']>('__total__')
  const [limitInput, setLimitInput] = useState('')
  const [goalOpen, setGoalOpen] = useState(false)
  const [goalInput, setGoalInput] = useState(String(toMajor(settings.monthlySavingsGoalPaise)))

  const thisMonth = monthKey(today)
  const rows = useMemo(() => budgetStatus(transactions, budgets, thisMonth, today), [transactions, budgets, thisMonth, today])
  const series = useMemo(() => monthlySeries(transactions), [transactions])
  const monthPoint = series.find((s) => s.month === thisMonth)

  const completed = series.filter((s) => s.month < thisMonth)
  const avgSavings = completed.length
    ? completed.slice(-3).reduce((a, s) => a + s.savingsPaise, 0) / Math.min(3, completed.length)
    : 0

  const goal = settings.monthlySavingsGoalPaise
  const savedThisMonth = monthPoint?.savingsPaise ?? 0
  const goalProgress = goal > 0 ? savedThisMonth / goal : 0

  const recommendations = useMemo(
    () =>
      buildRecommendations({
        transactions,
        recurring,
        budgets,
        settings,
        today,
        forecastPaise: ml.forecast?.ok ? Math.round((ml.forecast.nextMonthPrediction ?? 0) * 100) : null,
        forecastMonth: ml.forecast?.nextMonth ?? null,
      }),
    [transactions, recurring, budgets, settings, today, ml.forecast],
  )

  const totalPotential = recommendations.reduce((a, r) => a + r.estimatedSavingPaise, 0)
  const exceeded = rows.filter((r) => r.state === 'exceeded')
  const overPace = rows.filter((r) => r.overPace)
  const allTotals = computeTotals(transactions)

  const unbudgeted = CATEGORIES.filter((c) => !budgets.some((b) => b.category === c))

  const openEditor = (category: Budget['category']) => {
    setTargetCategory(category)
    const existing = budgets.find((b) => b.category === category)
    setLimitInput(existing ? String(toMajor(existing.limitPaise)) : '')
    setEditOpen(true)
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Monthly savings goal"
          value={goal > 0 ? formatMoney(goal, settings.currency) : 'Not set'}
          icon={Target}
          tone="accent"
          sublabel={goal > 0 ? `${formatPercent(Math.min(1, goalProgress), 0)} reached this month` : 'Set a target to track progress'}
          help="Your own target. Progress compares it with this month's income minus expenses."
        />
        <MetricCard
          label="Saved this month"
          value={formatMoney(savedThisMonth, settings.currency)}
          icon={PiggyBank}
          tone={savedThisMonth >= goal && goal > 0 ? 'success' : savedThisMonth > 0 ? 'warning' : 'danger'}
          sublabel={monthLabel(thisMonth)}
          help="Income minus expenses recorded in the current calendar month."
        />
        <MetricCard
          label="3-month average saving"
          value={formatMoney(Math.round(avgSavings), settings.currency)}
          icon={TrendingDown}
          sublabel={`Across ${Math.min(3, completed.length)} complete month(s)`}
          help="Mean of income minus expenses over your most recent complete months."
        />
        <MetricCard
          label="Estimated monthly opportunity"
          value={formatMoney(totalPotential, settings.currency)}
          icon={Lightbulb}
          tone="success"
          sublabel={`${recommendations.length} recommendation(s)`}
          help="Sum of the estimated savings from the recommendations below. Estimates only - not a guarantee."
        />
      </div>

      {exceeded.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
          <p className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--danger-ink)' }}>
            <AlertTriangle size={16} className="mt-px shrink-0" aria-hidden />
            <span>
              <strong>{exceeded.length} budget{exceeded.length === 1 ? '' : 's'} exceeded</strong> this month:{' '}
              {exceeded.map((e) => (e.category === '__total__' ? 'Total monthly' : e.category)).join(', ')}
            </span>
          </p>
        </Card>
      ) : null}

      {overPace.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
          <p className="flex items-start gap-2 text-[13px]" style={{ color: 'var(--warning-ink)' }}>
            <AlertTriangle size={16} className="mt-px shrink-0" aria-hidden />
            <span>
              <strong>Spending limit alert:</strong>{' '}
              {overPace.map((e) => (e.category === '__total__' ? 'Total monthly' : e.category)).join(', ')} are ahead of
              the pace needed to stay inside the budget for the rest of the month.
            </span>
          </p>
        </Card>
      ) : null}

      {/* ---- savings goal tracker ---- */}
      <Card>
        <CardHeader
          title="Savings Progress Tracker"
          description={`${monthLabel(thisMonth)} against your monthly goal`}
          icon={Target}
          action={
            <Button size="sm" variant="secondary" icon={Flag} onClick={() => { setGoalInput(String(toMajor(goal))); setGoalOpen(true) }}>
              {goal > 0 ? 'Change goal' : 'Set goal'}
            </Button>
          }
        />
        {goal > 0 ? (
          <div className="px-5 py-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="tnum text-[20px] font-semibold" style={{ color: 'var(--ink)' }}>
                {formatMoney(savedThisMonth, settings.currency)}
              </span>
              <span className="tnum text-[13px]" style={{ color: 'var(--ink-subtle)' }}>
                of {formatMoney(goal, settings.currency)} goal
              </span>
            </div>
            <ProgressBar
              value={goalProgress}
              tone={goalProgress >= 1 ? 'success' : goalProgress >= 0.5 ? 'accent' : 'warning'}
              label="Monthly savings goal progress"
            />
            <p className="mt-2.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              {goalProgress >= 1
                ? `Goal reached for ${monthLabel(thisMonth)}. Surplus of ${formatMoney(savedThisMonth - goal, settings.currency)}.`
                : `${formatMoney(Math.max(0, goal - savedThisMonth), settings.currency)} remaining to reach the goal this month.`}
            </p>
          </div>
        ) : (
          <EmptyState
            icon={Target}
            title="No savings goal set"
            description="Set a monthly target and FinSense AI will track progress and size the recommendations against it."
            action={
              <Button variant="primary" icon={Flag} onClick={() => setGoalOpen(true)}>
                Set monthly goal
              </Button>
            }
          />
        )}
      </Card>

      {/* ---- category budgets ---- */}
      <Card>
        <CardHeader
          title="Category Budgets"
          description={`Utilisation for ${monthLabel(thisMonth)} - the grey marker shows the expected pace`}
          icon={PiggyBank}
          action={
            <Button size="sm" variant="primary" icon={Plus} onClick={() => openEditor(unbudgeted[0] ?? '__total__')}>
              Add budget
            </Button>
          }
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="No budgets set"
            description="Set an overall monthly cap or per-category limits to see utilisation, pace alerts and exceeded warnings."
            action={
              <Button variant="primary" icon={Plus} onClick={() => openEditor('__total__')}>
                Set a budget
              </Button>
            }
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {rows.map((b) => (
              <li key={b.category} className="px-5 py-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                      {b.category === '__total__' ? 'Total monthly budget' : b.category}
                    </span>
                    {b.state === 'exceeded' ? (
                      <Badge tone="danger" icon={AlertTriangle}>
                        Exceeded
                      </Badge>
                    ) : b.state === 'warning' ? (
                      <Badge tone="warning">{formatPercent(b.utilisation, 0)} used</Badge>
                    ) : b.overPace ? (
                      <Badge tone="warning">Ahead of pace</Badge>
                    ) : (
                      <Badge tone="success">On track</Badge>
                    )}
                  </span>
                  <span className="tnum text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {formatMoney(b.spentPaise, settings.currency)} / {formatMoney(b.limitPaise, settings.currency)}
                  </span>
                </div>
                <ProgressBar
                  value={b.utilisation}
                  tone={b.state === 'exceeded' ? 'danger' : b.state === 'warning' || b.overPace ? 'warning' : 'success'}
                  marker={b.limitPaise > 0 ? b.pacePaise / b.limitPaise : undefined}
                  label={`${b.category} budget utilisation`}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="tnum text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                    {b.remainingPaise >= 0
                      ? `${formatMoney(b.remainingPaise, settings.currency)} remaining`
                      : `${formatMoney(-b.remainingPaise, settings.currency)} over budget`}
                  </p>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => openEditor(b.category)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={async () => {
                        await store.removeBudget(b.category)
                        store.pushToast('info', 'Budget removed.')
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- recommendations ---- */}
      <Card>
        <CardHeader
          title="Savings Recommendations"
          description="Each recommendation is calculated from your own category averages - no financial advice, no guarantees"
          icon={Lightbulb}
        />
        {recommendations.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="Not enough history for recommendations"
            description={
              transactions.length
                ? 'Recommendations compare at least two complete months of category averages. Keep recording transactions.'
                : 'Add or import transactions to generate recommendations.'
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
            {recommendations.map((r) => (
              <li key={r.key} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {r.title}
                      </p>
                      <Badge tone={r.difficulty === 'easy' ? 'success' : r.difficulty === 'moderate' ? 'warning' : 'danger'}>
                        {r.difficulty}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                      {r.rationale}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: 'var(--accent-ink)' }}>
                        Supporting months
                      </summary>
                      <ul className="mt-1.5 space-y-0.5 rounded-lg px-3 py-2" style={{ background: 'var(--surface-sunken)' }}>
                        {r.evidence.map((e, i) => (
                          <li key={i} className="tnum text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
                      Est. monthly saving
                    </p>
                    <p className="tnum text-[18px] font-semibold" style={{ color: 'var(--success-ink)' }}>
                      {formatMoney(r.estimatedSavingPaise, settings.currency)}
                    </p>
                    {r.category ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="mt-2"
                        icon={Check}
                        onClick={() => {
                          // Turn a recommendation into a concrete budget.
                          const cat = r.category as Category
                          const spend = transactions
                            .filter((t) => t.type === 'expense' && t.category === cat && monthKey(t.date) < thisMonth)
                            .reduce((a, t) => a + t.amountPaise, 0)
                          const months = Math.max(1, completed.length)
                          const suggested = Math.max(0, Math.round(spend / months) - r.estimatedSavingPaise)
                          setTargetCategory(cat)
                          setLimitInput(String(Math.round(toMajor(suggested))))
                          setEditOpen(true)
                        }}
                      >
                        Set budget
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-5 py-3.5" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
            These are transparent calculations on your recorded data, not financial advice, and no saving is
            guaranteed. Your overall savings rate across all recorded history is{' '}
            <span className="tnum font-semibold">{formatPercent(allTotals.savingsRate)}</span>.
          </p>
        </div>
      </Card>

      {/* ---- budget editor ---- */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Set a budget"
        description="Budgets apply per calendar month and drive the utilisation bars and alerts."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={async () => {
                const amount = Number(limitInput)
                if (!Number.isFinite(amount) || amount <= 0) {
                  store.pushToast('error', 'Enter a positive budget amount.')
                  return
                }
                await store.setBudget(targetCategory, toPaise(amount))
                setEditOpen(false)
                store.pushToast('success', 'Budget saved.')
              }}
            >
              Save budget
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Applies to">
            <Select value={targetCategory} onChange={(e) => setTargetCategory(e.target.value as Budget['category'])}>
              <option value="__total__">Total monthly spending</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Monthly limit (${settings.currency})`} required hint="Spending above this triggers an exceeded alert.">
            <TextInput type="number" min="0" step="1" value={limitInput} onChange={(e) => setLimitInput(e.target.value)} placeholder="0" />
          </Field>
          {(() => {
            // Show what the user actually spent, so the limit is informed.
            const spent = transactions
              .filter(
                (t) =>
                  t.type === 'expense' &&
                  monthKey(t.date) < thisMonth &&
                  (targetCategory === '__total__' || t.category === targetCategory),
              )
              .reduce((a, t) => a + t.amountPaise, 0)
            const months = Math.max(1, completed.length)
            return completed.length ? (
              <div className={cx('rounded-lg px-3.5 py-3')} style={{ background: 'var(--surface-sunken)' }}>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  Your average over {months} complete month(s) is{' '}
                  <span className="tnum font-semibold">{formatMoney(Math.round(spent / months), settings.currency)}</span>
                  {targetCategory === '__total__' ? ' in total spending.' : ` on ${targetCategory}.`}
                </p>
              </div>
            ) : null
          })()}
        </div>
      </Modal>

      {/* ---- goal editor ---- */}
      <Modal
        open={goalOpen}
        onClose={() => setGoalOpen(false)}
        title="Monthly savings goal"
        description="Used for the progress tracker and to size the savings-gap recommendation."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGoalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={() => {
                const amount = Number(goalInput)
                if (!Number.isFinite(amount) || amount < 0) {
                  store.pushToast('error', 'Enter a valid amount.')
                  return
                }
                store.updateSettings({ monthlySavingsGoalPaise: toPaise(amount) })
                setGoalOpen(false)
                store.pushToast('success', 'Savings goal updated.')
              }}
            >
              Save goal
            </Button>
          </>
        }
      >
        <Field
          label={`Target amount per month (${settings.currency})`}
          hint={
            completed.length
              ? `Your recent average saving is ${formatMoney(Math.round(avgSavings), settings.currency)} per month.`
              : undefined
          }
        >
          <TextInput type="number" min="0" step="100" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} />
        </Field>
      </Modal>
    </div>
  )
}
