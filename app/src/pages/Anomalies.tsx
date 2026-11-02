/**
 * Anomaly Detection - ML Module 3.
 *
 * Isolation Forest flags statistical outliers. Every flag carries the reasons
 * derived from the same features the model saw, and the page states clearly
 * that unusual is NOT fraud. Users can mark anything as normal, which removes
 * it from future scans.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Eye, Play, RotateCcw, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Select, Skeleton, TextInput } from '../components/ui'
import { MetricCard } from '../components/MetricCard'
import { useAppStore } from '../store/AppStore'
import { formatMoney, toPaise } from '../lib/money'
import { formatDate } from '../lib/dates'
import type { AnomalyRecord } from '../ml/protocol'
import type { PageProps } from './types'

export function Anomalies({ ml, runAnomalyScan, mlStatus, visibleAnomalies }: PageProps) {
  const store = useAppStore()
  const { settings, transactions, ignoredAnomalyIds } = store
  const report = ml.anomalies
  const [reviewing, setReviewing] = useState<AnomalyRecord | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [sensitivity, setSensitivity] = useState(String(settings.anomalyContamination))
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'score' | 'amount' | 'date'>('score')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = visibleAnomalies.filter(
      (a) => !q || `${a.merchant} ${a.description} ${a.category}`.toLowerCase().includes(q),
    )
    return [...list].sort((a, b) => {
      if (sortBy === 'amount') return b.amount - a.amount
      if (sortBy === 'date') return a.date < b.date ? 1 : -1
      return b.score - a.score
    })
  }, [visibleAnomalies, query, sortBy])

  const ignored = useMemo(
    () => transactions.filter((t) => ignoredAnomalyIds.includes(t.id)),
    [transactions, ignoredAnomalyIds],
  )

  const flaggedValue = rows.reduce((a, r) => a + toPaise(r.amount), 0)

  return (
    <div className="space-y-5">
      {/* ---- disclaimer, always visible ---- */}
      <Card className="flex items-start gap-3 px-5 py-4" as="div">
        <ShieldCheck size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden />
        <div>
          <p className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
            An unusual transaction is not confirmed fraud
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            These are statistical outliers compared with your own past behaviour. A legitimate large purchase will be
            flagged, and genuine fraud can look ordinary. FinSense AI never contacts your bank - if something looks
            genuinely wrong, contact your bank through its official app or helpline.
          </p>
        </div>
      </Card>

      {/* ---- control bar ---- */}
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" as="div">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
            {report?.ok
              ? `${report.model} analysed ${report.analysed} expense transactions`
              : 'Anomaly detection has not been run on this dataset yet'}
          </p>
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
            {ml.scanning
              ? mlStatus.message
              : report?.ok
                ? `Contamination ${((report.contamination ?? 0) * 100).toFixed(1)}% - scikit-learn, seed ${report.seed}`
                : 'Uses an unsupervised Isolation Forest over amount, timing and merchant-frequency features.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setShowSettings(true)}>
            Sensitivity
          </Button>
          <Button variant="primary" icon={Play} loading={ml.scanning} onClick={() => void runAnomalyScan()}>
            {report ? 'Re-scan' : 'Scan now'}
          </Button>
        </div>
      </Card>

      {ml.scanning && !report ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-5" as="div">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </Card>
          ))}
        </div>
      ) : null}

      {report && !report.ok ? (
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="Not enough transactions to detect anomalies"
            description={report.message ?? 'The model needs a baseline of normal behaviour before it can flag outliers.'}
          />
        </Card>
      ) : null}

      {!report && !ml.scanning ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No anomaly scan yet"
            description={
              transactions.length >= 25
                ? 'Run the scan to fit an Isolation Forest on your spending and surface statistical outliers.'
                : `Anomaly detection needs at least 25 expense transactions; you have ${transactions.filter((t) => t.type === 'expense').length}.`
            }
            action={
              transactions.filter((t) => t.type === 'expense').length >= 25 ? (
                <Button variant="primary" icon={Play} onClick={() => void runAnomalyScan()}>
                  Scan now
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      {report?.ok ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Transactions flagged"
              value={String(rows.length)}
              icon={AlertTriangle}
              tone={rows.length > 0 ? 'warning' : 'success'}
              sublabel={`of ${report.analysed} analysed`}
              help="Rows the Isolation Forest scored as outliers, excluding any you marked as normal."
            />
            <MetricCard
              label="Total flagged value"
              value={formatMoney(flaggedValue, settings.currency)}
              icon={AlertTriangle}
              tone="warning"
              sublabel="Sum of flagged amounts"
              help="The combined value of currently flagged transactions."
            />
            <MetricCard
              label="Marked as normal"
              value={String(ignored.length)}
              icon={CheckCircle2}
              tone="success"
              sublabel="Excluded from future scans"
              help="Transactions you confirmed are expected. They are removed from the training set on the next scan."
            />
            <MetricCard
              label="Detection rate"
              value={`${(((report.flagged ?? 0) / Math.max(1, report.analysed ?? 1)) * 100).toFixed(1)}%`}
              icon={SlidersHorizontal}
              sublabel={`Target ${((report.contamination ?? 0) * 100).toFixed(1)}% contamination`}
              help="Share of analysed transactions flagged. Adjust with the Sensitivity control."
            />
          </div>

          <Card>
            <CardHeader
              title={`${rows.length} unusual transaction${rows.length === 1 ? '' : 's'} to review`}
              description="Ordered by anomaly score - each flag lists why the model considered it unusual"
              icon={AlertTriangle}
              action={
                <div className="flex gap-2">
                  <TextInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter..."
                    className="!h-9 !w-32 !text-[13px] sm:!w-40"
                    aria-label="Filter anomalies"
                  />
                  <Select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="!h-9 !w-auto !text-[13px]"
                    aria-label="Sort anomalies"
                  >
                    <option value="score">By score</option>
                    <option value="amount">By amount</option>
                    <option value="date">By date</option>
                  </Select>
                </div>
              }
            />
            {rows.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title={query ? 'No flags match that filter' : 'No unusual transactions'}
                description={
                  query
                    ? 'Clear the filter to see all flagged transactions.'
                    : 'The model did not find statistical outliers in your current data, or you have marked them all as normal.'
                }
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {rows.map((a) => (
                  <li key={a.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                            {a.merchant || a.description || 'Untitled transaction'}
                          </p>
                          <Badge tone={a.score > 0.7 ? 'danger' : a.score > 0.45 ? 'warning' : 'neutral'}>
                            Score {a.score.toFixed(2)}
                          </Badge>
                          <Badge tone="neutral">{a.category}</Badge>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                          <span className="tnum">{formatDate(a.date, settings.dateFormat)}</span>
                          {a.description && a.merchant ? (
                            <>
                              <span aria-hidden>-</span>
                              <span className="truncate">{a.description}</span>
                            </>
                          ) : null}
                        </p>
                        <ul className="mt-2.5 space-y-1">
                          {a.reasons.map((r, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                              <span className="mt-1.5 size-1 shrink-0 rounded-full" style={{ background: 'var(--warning)' }} aria-hidden />
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className="tnum text-[17px] font-semibold" style={{ color: 'var(--ink)' }}>
                          {formatMoney(toPaise(a.amount), settings.currency)}
                        </span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" icon={Eye} onClick={() => setReviewing(a)}>
                            Review
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={CheckCircle2}
                            onClick={async () => {
                              await store.ignoreAnomaly(a.id)
                              store.pushToast('success', 'Marked as normal. It will be excluded from future scans.')
                            }}
                          >
                            Mark as normal
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {ignored.length > 0 ? (
            <Card>
              <CardHeader
                title={`${ignored.length} transaction(s) marked as normal`}
                description="These are excluded from the model's input on the next scan"
                icon={CheckCircle2}
              />
              <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {ignored.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                        {t.merchant || t.description}
                      </p>
                      <p className="tnum text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                        {formatDate(t.date, settings.dateFormat)} - {formatMoney(t.amountPaise, settings.currency)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={RotateCcw}
                      onClick={async () => {
                        await store.unignoreAnomaly(t.id)
                        store.pushToast('info', 'Restored. Re-scan to include it again.')
                      }}
                    >
                      Undo
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="px-5 py-4" as="div">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
              Features the model uses
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(report.features ?? []).map((f) => (
                <Badge key={f} tone="neutral">
                  {f}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
              These features are deliberately interpretable, which is what makes the "why it was flagged" explanations
              above honest: each reason is read back from the same values the Isolation Forest scored.
            </p>
          </Card>
        </>
      ) : null}

      {/* ---- review dialog ---- */}
      <Modal
        open={!!reviewing}
        onClose={() => setReviewing(null)}
        title="Review flagged transaction"
        description="Compare this against your own records. FinSense AI cannot verify it with your bank."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewing(null)}>
              Close
            </Button>
            <Button
              variant="success"
              icon={CheckCircle2}
              onClick={async () => {
                if (reviewing) {
                  await store.ignoreAnomaly(reviewing.id)
                  store.pushToast('success', 'Marked as normal.')
                }
                setReviewing(null)
              }}
            >
              This is normal
            </Button>
          </>
        }
      >
        {reviewing ? (
          <dl className="space-y-3 text-[13px]">
            {[
              ['Transaction ID', reviewing.id],
              ['Date', formatDate(reviewing.date, settings.dateFormat)],
              ['Merchant', reviewing.merchant || '--'],
              ['Description', reviewing.description || '--'],
              ['Category', reviewing.category],
              ['Amount', formatMoney(toPaise(reviewing.amount), settings.currency)],
              ['Anomaly score', `${reviewing.score.toFixed(3)} (0 = typical, 1 = most unusual)`],
              ['Category z-score', `${reviewing.zScore.toFixed(2)} standard deviations`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b pb-2.5" style={{ borderColor: 'var(--line)' }}>
                <dt style={{ color: 'var(--ink-muted)' }}>{k}</dt>
                <dd className="tnum text-right font-medium" style={{ color: 'var(--ink)' }}>
                  {v}
                </dd>
              </div>
            ))}
            <div>
              <dt className="mb-1.5 font-semibold" style={{ color: 'var(--ink)' }}>
                Why it was flagged
              </dt>
              <dd>
                <ul className="space-y-1">
                  {reviewing.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5" style={{ color: 'var(--ink-muted)' }}>
                      <span className="mt-1.5 size-1 shrink-0 rounded-full" style={{ background: 'var(--warning)' }} aria-hidden />
                      {r}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      {/* ---- sensitivity dialog ---- */}
      <Modal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="Detection sensitivity"
        description="Contamination is the share of transactions the Isolation Forest is told to treat as outliers."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const v = Math.min(0.2, Math.max(0.005, Number(sensitivity) || 0.04))
                store.updateSettings({ anomalyContamination: v })
                setShowSettings(false)
                await runAnomalyScan()
              }}
            >
              Apply and re-scan
            </Button>
          </>
        }
      >
        <Field
          label="Contamination"
          hint="0.01 = flag about 1% of transactions (strict). 0.10 = flag about 10% (sensitive). Default 0.04."
        >
          <TextInput
            type="number"
            min="0.005"
            max="0.2"
            step="0.005"
            value={sensitivity}
            onChange={(e) => setSensitivity(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  )
}
