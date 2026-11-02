/**
 * Subscriptions - recurring payment detection.
 *
 * The detector finds periodicity in merchant groups; the user confirms, edits
 * or dismisses each rule, and those decisions survive re-detection.
 */

import { useMemo, useState } from 'react'
import { CalendarClock, Check, Pencil, RefreshCw, Repeat, Trash2, X } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Select, TextInput } from '../components/ui'
import { MetricCard } from '../components/MetricCard'
import { useAppStore } from '../store/AppStore'
import { monthlyCostPaise, recurringMonthlyTotal, upcomingPayments } from '../lib/recurring'
import { monthlySeries } from '../lib/analytics'
import { formatDate, monthKey } from '../lib/dates'
import { formatMoney, formatPercent, toPaise, toMajor } from '../lib/money'
import { CATEGORIES, type Category, type RecurringRule } from '../lib/types'
import type { PageProps } from './types'

const FREQ_LABEL: Record<RecurringRule['frequency'], string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

export function Subscriptions({ navigate }: PageProps) {
  const store = useAppStore()
  const { recurring, settings, transactions, today } = store
  const [editing, setEditing] = useState<RecurringRule | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState<Category>('Subscriptions')
  const [draftAmount, setDraftAmount] = useState('')
  const [tab, setTab] = useState<'active' | 'dismissed'>('active')

  const activeRules = recurring.filter((r) => r.status !== 'dismissed')
  const dismissedRules = recurring.filter((r) => r.status === 'dismissed')
  const shown = tab === 'active' ? activeRules : dismissedRules

  const monthlyTotal = useMemo(() => recurringMonthlyTotal(activeRules), [activeRules])
  const upcoming = useMemo(() => upcomingPayments(recurring, today, 45), [recurring, today])

  // Share of average monthly expenses, using complete months only.
  const share = useMemo(() => {
    const series = monthlySeries(transactions).filter((s) => s.month < monthKey(today))
    if (!series.length) return null
    const recent = series.slice(-3)
    const avg = recent.reduce((a, s) => a + s.expensePaise, 0) / recent.length
    return avg > 0 ? monthlyTotal / avg : null
  }, [transactions, today, monthlyTotal])

  const subsOnly = activeRules.filter((r) => r.category === 'Subscriptions')

  const openEdit = (r: RecurringRule) => {
    setEditing(r)
    setDraftName(r.name)
    setDraftCategory(r.category)
    setDraftAmount(String(toMajor(r.averagePaise)))
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Monthly recurring expense"
          value={formatMoney(monthlyTotal, settings.currency)}
          icon={Repeat}
          tone="accent"
          sublabel={`${activeRules.length} active rule${activeRules.length === 1 ? '' : 's'}`}
          help="Each rule's average charge normalised to a monthly cost (weekly x 52/12, quarterly / 3, yearly / 12)."
        />
        <MetricCard
          label="Share of monthly expenses"
          value={share !== null ? formatPercent(share) : '--'}
          icon={Repeat}
          tone={share !== null && share > 0.45 ? 'warning' : 'neutral'}
          sublabel="Against your 3-month average"
          help="Monthly recurring cost divided by the mean expenses of your last three complete months."
        />
        <MetricCard
          label="Subscriptions"
          value={formatMoney(subsOnly.reduce((a, r) => a + monthlyCostPaise(r), 0), settings.currency)}
          icon={Repeat}
          sublabel={`${subsOnly.length} detected`}
          help="Only rules categorised as Subscriptions - the fastest category to reduce."
        />
        <MetricCard
          label="Annual commitment"
          value={formatMoney(monthlyTotal * 12, settings.currency)}
          icon={CalendarClock}
          tone="warning"
          sublabel="Projected from current rules"
          help="Monthly recurring cost x 12. A projection, not a guarantee."
        />
      </div>

      {upcoming.length > 0 ? (
        <Card>
          <CardHeader title="Upcoming payments" description="Projected over the next 45 days from the detected cadence" icon={CalendarClock} />
          <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
            {upcoming.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="tnum flex size-9 shrink-0 flex-col items-center justify-center rounded-lg text-[11px] font-semibold leading-none"
                    style={{
                      background: p.daysUntil <= 3 ? 'var(--warning-soft)' : 'var(--surface-sunken)',
                      color: p.daysUntil <= 3 ? 'var(--warning-ink)' : 'var(--ink-muted)',
                    }}
                  >
                    <span>{p.nextDate.slice(8, 10)}</span>
                    <span className="mt-0.5 text-[8.5px] uppercase opacity-70">{p.nextDate.slice(5, 7)}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                      {p.name}
                    </p>
                    <p className="text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                      {p.daysUntil === 0 ? 'Due today' : `in ${p.daysUntil} day${p.daysUntil === 1 ? '' : 's'}`} -{' '}
                      {FREQ_LABEL[p.frequency]} - {p.category}
                    </p>
                  </div>
                </div>
                <span className="tnum shrink-0 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {formatMoney(p.averagePaise, settings.currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Detected recurring payments"
          description="Found by analysing the gaps between repeated charges at the same merchant"
          icon={Repeat}
          action={
            <div className="flex gap-2">
              <Select
                value={tab}
                onChange={(e) => setTab(e.target.value as 'active' | 'dismissed')}
                className="!h-9 !w-auto !text-[13px]"
                aria-label="Filter rules"
              >
                <option value="active">Active ({activeRules.length})</option>
                <option value="dismissed">Dismissed ({dismissedRules.length})</option>
              </Select>
              <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void store.refreshRecurring()}>
                Re-detect
              </Button>
            </div>
          }
        />

        {shown.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={tab === 'dismissed' ? 'Nothing dismissed' : 'No recurring payments detected'}
            description={
              tab === 'dismissed'
                ? 'Rules you dismiss appear here and stay dismissed through future detections.'
                : transactions.length
                  ? 'Detection needs at least three charges at the same merchant with a consistent gap (weekly, monthly, quarterly or yearly).'
                  : 'Add or import transactions first.'
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
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                  <th className="p-3 text-left font-semibold">Subscription</th>
                  <th className="p-3 text-left font-semibold">Merchant</th>
                  <th className="p-3 text-right font-semibold">Average</th>
                  <th className="p-3 text-left font-semibold">Frequency</th>
                  <th className="p-3 text-left font-semibold">Last paid</th>
                  <th className="p-3 text-left font-semibold">Next (est.)</th>
                  <th className="p-3 text-right font-semibold">Per month</th>
                  <th className="p-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium" style={{ color: 'var(--ink)' }}>
                          {r.name}
                        </span>
                        {r.status === 'confirmed' ? (
                          <Badge tone="success" icon={Check}>
                            Confirmed
                          </Badge>
                        ) : r.status === 'dismissed' ? (
                          <Badge tone="neutral">Dismissed</Badge>
                        ) : (
                          <Badge tone="accent">{Math.round(r.confidence * 100)}% match</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                        {r.category} - {r.occurrences} charges on record
                      </p>
                    </td>
                    <td className="max-w-[180px] truncate p-3" style={{ color: 'var(--ink-muted)' }} title={r.merchant}>
                      {r.merchant}
                    </td>
                    <td className="tnum p-3 text-right font-medium" style={{ color: 'var(--ink)' }}>
                      {formatMoney(r.averagePaise, settings.currency)}
                    </td>
                    <td className="p-3" style={{ color: 'var(--ink-muted)' }}>
                      {FREQ_LABEL[r.frequency]}
                      <span className="tnum block text-[11px]" style={{ color: 'var(--ink-subtle)' }}>
                        every {r.intervalDays}d
                      </span>
                    </td>
                    <td className="tnum whitespace-nowrap p-3" style={{ color: 'var(--ink-muted)' }}>
                      {formatDate(r.lastDate, settings.dateFormat)}
                    </td>
                    <td className="tnum whitespace-nowrap p-3" style={{ color: 'var(--ink-muted)' }}>
                      {formatDate(r.nextDate, settings.dateFormat)}
                    </td>
                    <td className="tnum p-3 text-right font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatMoney(monthlyCostPaise(r), settings.currency)}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        {r.status !== 'confirmed' && r.status !== 'dismissed' ? (
                          <button
                            type="button"
                            onClick={() => void store.setRecurringStatus(r.id, 'confirmed')}
                            aria-label={`Confirm ${r.name}`}
                            className="rounded p-1.5 hover:opacity-70"
                            style={{ color: 'var(--success)' }}
                          >
                            <Check size={14} aria-hidden />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          aria-label={`Edit ${r.name}`}
                          className="rounded p-1.5 hover:opacity-70"
                          style={{ color: 'var(--ink-subtle)' }}
                        >
                          <Pencil size={14} aria-hidden />
                        </button>
                        {r.status === 'dismissed' ? (
                          <button
                            type="button"
                            onClick={() => void store.setRecurringStatus(r.id, 'detected')}
                            aria-label={`Restore ${r.name}`}
                            className="rounded p-1.5 hover:opacity-70"
                            style={{ color: 'var(--accent)' }}
                          >
                            <RefreshCw size={14} aria-hidden />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void store.setRecurringStatus(r.id, 'dismissed')}
                            aria-label={`Dismiss ${r.name}`}
                            className="rounded p-1.5 hover:opacity-70"
                            style={{ color: 'var(--danger)' }}
                          >
                            <X size={14} aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t px-5 py-3.5" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
            Detection groups charges by a normalised merchant key, takes the median gap between charge dates, snaps it
            to the nearest standard cadence, then scores how consistent the gaps and amounts are. Rules below a 45%
            match score are not shown. Confirming or editing a rule locks your choice against future re-detection.
          </p>
        </div>
      </Card>

      {/* ---- edit dialog ---- */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit recurring payment"
        description="Your changes override the detector for this merchant."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (editing) await store.setRecurringStatus(editing.id, 'dismissed')
                setEditing(null)
                store.pushToast('info', 'Rule dismissed.')
              }}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              icon={Check}
              onClick={async () => {
                if (!editing) return
                const amount = Number(draftAmount)
                await store.updateRecurring(editing.id, {
                  name: draftName.trim() || editing.merchant,
                  category: draftCategory,
                  averagePaise: Number.isFinite(amount) && amount > 0 ? toPaise(amount) : editing.averagePaise,
                  status: 'confirmed',
                })
                setEditing(null)
                store.pushToast('success', 'Recurring payment confirmed.')
              }}
            >
              Save and confirm
            </Button>
          </>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="Subscription name">
              <TextInput value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={editing.merchant} />
            </Field>
            <Field label="Category">
              <Select value={draftCategory} onChange={(e) => setDraftCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Expected amount" hint={`Detected average: ${formatMoney(editing.averagePaise, settings.currency)}`}>
              <TextInput type="number" min="0" step="0.01" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} />
            </Field>
            <div className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken)' }}>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                Detected as <strong>{FREQ_LABEL[editing.frequency].toLowerCase()}</strong> every {editing.intervalDays}{' '}
                days across {editing.occurrences} charges, most recently on{' '}
                {formatDate(editing.lastDate, settings.dateFormat)}.
              </p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
