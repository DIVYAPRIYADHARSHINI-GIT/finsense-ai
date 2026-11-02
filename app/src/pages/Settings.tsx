/**
 * Settings - preferences, data management and privacy information.
 *
 * Destructive actions are all behind typed confirmations, and the privacy
 * section states exactly what the app does and does not do with the data.
 */

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  Database,
  Download,
  HardDrive,
  Lock,
  Palette,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { Badge, Button, Card, CardHeader, Field, ProgressBar, Select, TextInput, useConfirm } from '../components/ui'
import { useAppStore } from '../store/AppStore'
import { formatBytes, parseBackup, serialiseBackup, storageUsage, type StorageUsage } from '../lib/storage'
import { runMLJob } from '../store/useMLWorker'
import { generateSampleTransactions, sampleDataSummary } from '../lib/sample-data'
import { formatMoney, toMajor, toPaise } from '../lib/money'
import { todayISO } from '../lib/dates'
import { CURRENCY_META, type Settings as SettingsType } from '../lib/types'
import type { RuntimeInfo } from '../ml/protocol'
import type { PageProps } from './types'

export function SettingsPage({ ml, navigate }: PageProps) {
  const store = useAppStore()
  const confirm = useConfirm()
  const { settings, transactions, budgets, recurring } = store
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [goalInput, setGoalInput] = useState(String(toMajor(settings.monthlySavingsGoalPaise)))
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void storageUsage().then(setUsage)
  }, [transactions.length])

  const update = (patch: Partial<SettingsType>) => store.updateSettings(patch)

  const sampleFacts = sampleDataSummary(generateSampleTransactions({ today: todayISO() }))

  const downloadBackup = () => {
    const json = serialiseBackup({
      transactions,
      budgets,
      recurring,
      settings,
      ignoredAnomalyIds: store.ignoredAnomalyIds,
      insightFeedback: store.insightFeedback,
    })
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finsense-backup-${todayISO()}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    store.pushToast('success', `Backup exported with ${transactions.length} transaction(s).`)
  }

  const restore = async (file: File) => {
    try {
      const text = await file.text()
      const { data, warnings } = parseBackup(text)
      const ok = await confirm({
        title: 'Replace all current data?',
        message: `This backup contains ${data.transactions.length} transaction(s). Restoring replaces everything currently stored in this browser.`,
        confirmLabel: 'Restore backup',
        tone: 'danger',
      })
      if (!ok) return
      await store.restoreBackup(data)
      for (const w of warnings) store.pushToast('warning', w)
      store.pushToast('success', `Restored ${data.transactions.length} transaction(s).`)
    } catch (err) {
      store.pushToast('error', err instanceof Error ? err.message : 'Could not read that backup file.')
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- preferences ---- */}
      <Card>
        <CardHeader title="Preferences" description="Formatting and display options for this browser" icon={Settings2} />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Currency" hint="Changes formatting only - stored amounts are not converted.">
            <Select value={settings.currency} onChange={(e) => update({ currency: e.target.value as SettingsType['currency'] })}>
              {(Object.keys(CURRENCY_META) as SettingsType['currency'][]).map((c) => (
                <option key={c} value={c}>
                  {c} ({CURRENCY_META[c].symbol})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date format">
            <Select value={settings.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as SettingsType['dateFormat'] })}>
              <option value="dd MMM yyyy">31 Mar 2025</option>
              <option value="dd/MM/yyyy">31/03/2025</option>
              <option value="MM/dd/yyyy">03/31/2025</option>
              <option value="yyyy-MM-dd">2025-03-31</option>
            </Select>
          </Field>
          <Field label="Theme" hint="Dark mode is designed separately, not an inversion of light mode.">
            <Select value={settings.theme} onChange={(e) => update({ theme: e.target.value as SettingsType['theme'] })}>
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
          <Field label={`Monthly savings goal (${settings.currency})`}>
            <div className="flex gap-2">
              <TextInput type="number" min="0" step="100" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} />
              <Button
                variant="secondary"
                onClick={() => {
                  const v = Number(goalInput)
                  if (!Number.isFinite(v) || v < 0) {
                    store.pushToast('error', 'Enter a valid amount.')
                    return
                  }
                  update({ monthlySavingsGoalPaise: toPaise(v) })
                  store.pushToast('success', 'Savings goal updated.')
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <Field
            label="Auto-apply confidence threshold"
            hint="ML predictions below this confidence are flagged 'Uncertain - Review Category' instead of being trusted."
          >
            <TextInput
              type="number"
              min="0.1"
              max="0.95"
              step="0.05"
              value={settings.autoApplyConfidence}
              onChange={(e) => update({ autoApplyConfidence: Math.min(0.95, Math.max(0.1, Number(e.target.value) || 0.55)) })}
            />
          </Field>
          <Field label="Anomaly contamination" hint="Share of transactions the Isolation Forest treats as outliers. Default 0.04.">
            <TextInput
              type="number"
              min="0.005"
              max="0.2"
              step="0.005"
              value={settings.anomalyContamination}
              onChange={(e) => update({ anomalyContamination: Math.min(0.2, Math.max(0.005, Number(e.target.value) || 0.04)) })}
            />
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2.5 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              <input
                type="checkbox"
                checked={settings.reducedMotion}
                onChange={(e) => update({ reducedMotion: e.target.checked })}
                className="mt-0.5 size-4 rounded"
              />
              <span>
                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                  Reduce motion
                </span>
                <br />
                Disables transitions and the skeleton shimmer. Your operating system's reduced-motion setting is already
                respected automatically; this forces it on regardless.
              </span>
            </label>
          </div>
        </div>
      </Card>

      {/* ---- ML runtime ---- */}
      <Card>
        <CardHeader
          title="Machine learning runtime"
          description="Real CPython with scikit-learn, compiled to WebAssembly and executed in a Web Worker"
          icon={Brain}
          action={
            <Button
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              loading={runtimeBusy}
              onClick={async () => {
                setRuntimeBusy(true)
                try {
                  setRuntime(await runMLJob<RuntimeInfo>('runtime-info', {}))
                  store.pushToast('success', 'Python runtime responded.')
                } catch (err) {
                  store.pushToast('error', `Runtime check failed: ${err instanceof Error ? err.message : String(err)}`)
                } finally {
                  setRuntimeBusy(false)
                }
              }}
            >
              Check runtime
            </Button>
          }
        />
        <div className="px-5 py-5">
          {runtime ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Python', runtime.python],
                ['NumPy', runtime.numpy],
                ['Pandas', runtime.pandas],
                ['scikit-learn', runtime.sklearn],
                ['Random seed', String(runtime.seed)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken)' }}>
                  <p className="text-[11.5px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
                    {k}
                  </p>
                  <p className="tnum mt-0.5 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {v}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Click "Check runtime" to boot Python and report the exact library versions running in this browser. The
              first run downloads about 25 MB of WebAssembly packages from the free jsDelivr CDN and is then cached.
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ['Classifier', ml.classifier?.ok ? `${ml.classifier.bestModel} - ${((ml.classifier.testAccuracy ?? 0) * 100).toFixed(1)}%` : 'Not trained'],
              ['Forecast', ml.forecast?.ok ? `${ml.forecast.bestModel}` : ml.forecast?.needsMoreData ? 'Needs more history' : 'Not run'],
              ['Anomaly scan', ml.anomalies?.ok ? `${ml.anomalies.flagged} flagged of ${ml.anomalies.analysed}` : 'Not run'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg px-3.5 py-3" style={{ background: 'var(--surface-sunken)' }}>
                <p className="text-[11.5px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
                  {k}
                </p>
                <p className="mt-0.5 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {v}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ---- data management ---- */}
      <Card>
        <CardHeader title="Data import and export" description="Everything is a local file operation" icon={Database} />
        <div className="space-y-3 px-5 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                JSON backup
              </p>
              <p className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                {transactions.length} transaction(s), {budgets.length} budget(s), {recurring.length} recurring rule(s)
              </p>
            </div>
            <Button variant="secondary" icon={Download} onClick={downloadBackup} disabled={!transactions.length}>
              Export backup
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                Restore from backup
              </p>
              <p className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                Replaces all current data. The file is validated before anything is written.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void restore(f)
                e.target.value = ''
              }}
            />
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>
              Choose backup file
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                CSV import and export
              </p>
              <p className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                Column mapping, delimiter detection and row-level error reporting live on the Transactions page.
              </p>
            </div>
            <Button variant="secondary" onClick={() => navigate('transactions')}>
              Go to transactions
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- sample data ---- */}
      <Card>
        <CardHeader title="Sample data" description="A clearly fictional dataset for exploring every feature" icon={Sparkles} />
        <div className="space-y-3 px-5 py-5">
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--accent-ink)' }}>
              The sample dataset contains {sampleFacts.count} transactions across {sampleFacts.months} months with{' '}
              {sampleFacts.categories} categories. Every merchant and employer in it is invented. It deliberately includes
              planted high-value outliers, nine recurring commitments and a festive-season bump so classification,
              forecasting, anomaly detection and recurring detection all have something real to find.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={Sparkles}
              onClick={async () => {
                const ok = transactions.length
                  ? await confirm({
                      title: 'Replace current data with sample data?',
                      message: `This removes your ${transactions.length} stored transaction(s) and loads the fictional dataset instead. Export a backup first if you need it.`,
                      confirmLabel: 'Load sample data',
                      tone: 'danger',
                    })
                  : true
                if (!ok) return
                const n = await store.loadSampleData()
                if (n) store.pushToast('success', `Loaded ${n} fictional sample transactions.`)
              }}
            >
              Load sample data
            </Button>
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Reset the demo?',
                  message: 'Regenerates the sample dataset and clears budgets, recurring decisions and dismissed insights.',
                  confirmLabel: 'Reset demo',
                  tone: 'danger',
                })
                if (!ok) return
                const n = await store.loadSampleData()
                if (n) store.pushToast('success', 'Demo reset.')
              }}
            >
              Reset demo
            </Button>
            <Button
              variant="secondary"
              icon={Trash2}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Start fresh?',
                  message: 'Removes all transactions, budgets and recurring rules from this browser so you can begin with your own data.',
                  confirmLabel: 'Start fresh',
                  tone: 'danger',
                  requireTyped: 'START FRESH',
                })
                if (!ok) return
                await store.startFresh()
                store.pushToast('success', 'All data cleared. You can now import your own CSV.')
              }}
            >
              Start fresh
            </Button>
          </div>
        </div>
      </Card>

      {/* ---- storage ---- */}
      <Card>
        <CardHeader title="Storage usage" description="Browser quota consumed by this app's origin" icon={HardDrive} />
        <div className="px-5 py-5">
          {usage?.supported ? (
            <>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="tnum text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {formatBytes(usage.usageBytes)}
                </span>
                <span className="tnum text-[12.5px]" style={{ color: 'var(--ink-subtle)' }}>
                  of {formatBytes(usage.quotaBytes)} available ({(usage.ratio * 100).toFixed(2)}%)
                </span>
              </div>
              <ProgressBar value={usage.ratio} tone={usage.ratio > 0.8 ? 'danger' : usage.ratio > 0.5 ? 'warning' : 'success'} label="Storage used" />
              <p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
                Includes IndexedDB transactions and the cached Python/WebAssembly packages. If the quota is ever
                exceeded, FinSense AI shows an error and asks you to export a backup rather than losing data silently.
              </p>
            </>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              This browser does not expose a storage estimate. Your data is still stored locally in IndexedDB.
            </p>
          )}
        </div>
      </Card>

      {/* ---- privacy ---- */}
      <Card>
        <CardHeader title="Privacy" description="What FinSense AI does and does not do" icon={Lock} />
        <div className="space-y-4 px-5 py-5">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--success-ink)' }}>
              <Check size={13} aria-hidden /> What happens
            </p>
            <ul className="space-y-1.5">
              {[
                'Transactions are stored in this browser\'s IndexedDB and preferences in localStorage.',
                'Machine learning runs on your own CPU through WebAssembly Python - your data is never sent to a model API.',
                'CSV files you import are read in the browser and never uploaded.',
                'Exports (CSV, PDF, JSON) are generated locally and saved by your browser.',
                'The Python runtime and scikit-learn wheels are downloaded once from a public CDN. That is a code download only.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  <Check size={13} className="mt-1 shrink-0" style={{ color: 'var(--success)' }} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--danger-ink)' }}>
              <AlertTriangle size={13} aria-hidden /> What never happens
            </p>
            <ul className="space-y-1.5">
              {[
                'No bank account connection and no bank passwords, UPI PINs, OTPs or card details are ever requested.',
                'No cloud database, no server-side storage and no user accounts.',
                'No analytics, telemetry or third-party trackers.',
                'No paid APIs, no external LLM calls and no payment processing.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  <AlertTriangle size={13} className="mt-1 shrink-0" style={{ color: 'var(--danger)' }} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--warning-soft)' }}>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--warning-ink)' }}>
              Because everything is local, clearing your browser data or using private browsing will delete your
              transactions. Export a JSON backup regularly. FinSense AI is a personal analysis tool, not financial
              advice, and its forecasts are estimates from your own history.
            </p>
          </div>
        </div>
      </Card>

      {/* ---- danger zone ---- */}
      <Card>
        <CardHeader title="Clear all data" description="Irreversible - export a backup first" icon={Trash2} />
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div className="min-w-0">
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Permanently removes {transactions.length} transaction(s), {budgets.length} budget(s) and all saved
              decisions from this browser.
            </p>
            <p className="tnum mt-1 text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
              Current balance on record:{' '}
              {formatMoney(
                transactions.reduce((a, t) => a + (t.type === 'income' ? t.amountPaise : -t.amountPaise), 0),
                settings.currency,
              )}
            </p>
          </div>
          <Button
            variant="danger"
            icon={Trash2}
            disabled={!transactions.length}
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete everything?',
                message: 'This cannot be undone. All transactions, budgets, recurring rules and preferences stored in this browser will be removed.',
                confirmLabel: 'Delete all data',
                tone: 'danger',
                requireTyped: 'DELETE',
              })
              if (!ok) return
              await store.startFresh()
              store.pushToast('success', 'All data deleted from this browser.')
            }}
          >
            Clear all data
          </Button>
        </div>
      </Card>

      <Card className="px-5 py-4" as="div">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Palette size={15} style={{ color: 'var(--ink-subtle)' }} aria-hidden />
            <p className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
              FinSense AI - free and open-source stack: React, TypeScript, Tailwind, Recharts, Pyodide, scikit-learn.
            </p>
          </div>
          <Badge tone="neutral">Schema v2</Badge>
        </div>
      </Card>
    </div>
  )
}
