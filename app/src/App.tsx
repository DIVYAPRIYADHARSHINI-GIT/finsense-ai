/**
 * FinSense AI root.
 *
 * Owns theme application, routing, and the ML coordination that pages share:
 * the classifier, the forecast and the anomaly scan are each computed once and
 * handed down, so switching pages never retrains a model unnecessarily.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppShell, useHashRoute } from './components/AppShell'
import { ConfirmProvider, ToastViewport } from './components/ui'
import { AppStoreProvider, useAppStore } from './store/AppStore'
import { useMLWorker } from './store/useMLWorker'
import type { AnomalyReport, ClassifierReport, ForecastReport } from './ml/protocol'
import type { MLState } from './pages/types'
import { Dashboard } from './pages/Dashboard'
import { Transactions } from './pages/Transactions'
import { Insights } from './pages/Insights'
import { Forecast } from './pages/Forecast'
import { Anomalies } from './pages/Anomalies'
import { Subscriptions } from './pages/Subscriptions'
import { Budgets } from './pages/Budgets'
import { Reports } from './pages/Reports'
import { SettingsPage } from './pages/Settings'
import { toMajor } from './lib/money'
import type { Transaction } from './lib/types'

/** Shape a transaction for the Python layer: rupees, flat fields, no paise. */
function toMLRecord(t: Transaction) {
  return {
    id: t.id,
    date: t.date,
    description: t.description,
    merchant: t.merchant,
    amount: toMajor(t.amountPaise),
    type: t.type,
    category: t.category,
  }
}

function Inner() {
  const store = useAppStore()
  const { status: mlStatus, run } = useMLWorker()
  const [route, navigate] = useHashRoute()
  const [ml, setML] = useState<MLState>({
    classifier: null,
    forecast: null,
    anomalies: null,
    classifierRows: null,
    forecastRows: null,
    anomalyRows: null,
    trainingClassifier: false,
    forecasting: false,
    scanning: false,
  })

  // --- theme ---------------------------------------------------------------
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const effectiveTheme = store.settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : store.settings.theme

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    document.documentElement.dataset.reducedMotion = String(store.settings.reducedMotion)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', effectiveTheme === 'dark' ? '#0f172a' : '#f8fafc')
  }, [effectiveTheme, store.settings.reducedMotion])

  const toggleTheme = useCallback(() => {
    store.updateSettings({ theme: effectiveTheme === 'dark' ? 'light' : 'dark' })
  }, [store, effectiveTheme])

  // --- ML jobs ---------------------------------------------------------------
  // Every ML result is tagged with the dataset generation it was computed from,
  // so a result that lands after the data was replaced is discarded instead of
  // being shown as a fact about data that no longer exists.
  const datasetGeneration = useRef(0)

  const labelled = useMemo(
    () =>
      store.transactions.filter(
        (t) => t.categorySource !== 'ml' && (t.merchant.trim() || t.description.trim()),
      ),
    [store.transactions],
  )

  const trainClassifier = useCallback(async () => {
    if (labelled.length < 30) {
      store.pushToast('warning', `Need at least 30 categorised transactions to train (you have ${labelled.length}).`)
      return null
    }
    const generation = datasetGeneration.current
    const rowCount = store.transactions.length
    setML((m) => ({ ...m, trainingClassifier: true }))
    try {
      const report = await run<ClassifierReport>('train-classifier', {
        samples: labelled.map((t) => ({ merchant: t.merchant, description: t.description, category: t.category })),
      })
      if (generation !== datasetGeneration.current) return null
      setML((m) => ({ ...m, classifier: report, classifierRows: rowCount, trainingClassifier: false }))
      if (report.ok) {
        store.pushToast(
          'success',
          `${report.bestModel} selected - ${((report.testAccuracy ?? 0) * 100).toFixed(1)}% holdout accuracy.`,
        )
      } else {
        store.pushToast('warning', report.message ?? 'The classifier could not be trained.')
      }
      return report
    } catch (err) {
      setML((m) => ({ ...m, trainingClassifier: false }))
      store.pushToast('error', `Classifier training failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }, [labelled, run, store])

  const runForecast = useCallback(async () => {
    const generation = datasetGeneration.current
    const rowCount = store.transactions.length
    setML((m) => ({ ...m, forecasting: true }))
    try {
      const report = await run<ForecastReport>('forecast', {
        records: store.transactions.map(toMLRecord),
        today: store.today,
      })
      if (generation !== datasetGeneration.current) return null
      setML((m) => ({ ...m, forecast: report, forecastRows: rowCount, forecasting: false }))
      if (!report.ok && !report.needsMoreData) store.pushToast('warning', report.message ?? 'Forecast unavailable.')
      return report
    } catch (err) {
      setML((m) => ({ ...m, forecasting: false }))
      store.pushToast('error', `Forecasting failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }, [run, store])

  const runAnomalyScan = useCallback(async () => {
    const generation = datasetGeneration.current
    const rowCount = store.transactions.length
    setML((m) => ({ ...m, scanning: true }))
    try {
      const report = await run<AnomalyReport>('anomalies', {
        records: store.transactions.map(toMLRecord),
        ignoredIds: store.ignoredAnomalyIds,
        contamination: store.settings.anomalyContamination,
      })
      if (generation !== datasetGeneration.current) return null
      setML((m) => ({ ...m, anomalies: report, anomalyRows: rowCount, scanning: false }))
      if (!report.ok && !report.needsMoreData) store.pushToast('warning', report.message ?? 'Anomaly scan unavailable.')
      return report
    } catch (err) {
      setML((m) => ({ ...m, scanning: false }))
      store.pushToast('error', `Anomaly detection failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }, [run, store])

  /** Predict categories for specific rows and write back the confident ones. */
  const predictAndApply = useCallback(
    async (ids: string[]) => {
      const targets = store.transactions.filter((t) => ids.includes(t.id))
      if (!targets.length) return
      if (!ml.classifier?.ok) {
        const trained = await trainClassifier()
        if (!trained?.ok) return
      }
      const res = await run<{ ok: boolean; predictions?: { id: string; category: string; confidence: number; uncertain: boolean }[]; message?: string }>(
        'predict-categories',
        { items: targets.map((t) => ({ id: t.id, merchant: t.merchant, description: t.description })) },
      )
      if (!res.ok || !res.predictions) {
        store.pushToast('warning', res.message ?? 'Prediction unavailable.')
        return
      }
      const threshold = store.settings.autoApplyConfidence
      const confident = res.predictions.filter((p) => !p.uncertain && p.confidence >= threshold)
      await store.updateTransactions(
        res.predictions.map((p) => ({
          id: p.id,
          patch: {
            // Low-confidence rows keep their prediction for display but are
            // left flagged so the UI can ask the user to review them.
            category: p.category as Transaction['category'],
            categorySource: 'ml' as const,
            mlConfidence: p.confidence,
          },
        })),
      )
      store.pushToast(
        'success',
        `${res.predictions.length} transaction(s) classified - ${confident.length} confident, ${res.predictions.length - confident.length} need review.`,
      )
    },
    [store, ml.classifier, run, trainClassifier],
  )

  // --- automatic first-run ML -------------------------------------------------
  // Runs the forecast + anomaly scan once after data is ready, then only on
  // explicit user action. This avoids retraining on every keystroke/edit.
  const autoRan = useRef(false)
  useEffect(() => {
    if (!store.ready || autoRan.current) return
    if (store.transactions.length < 25) return
    autoRan.current = true
    void (async () => {
      await runAnomalyScan()
      await runForecast()
    })()
  }, [store.ready, store.transactions.length, runAnomalyScan, runForecast])

  // Model outputs describe a specific dataset, so they are tagged with the
  // dataset they were computed from. A bulk replacement (Clear all data, Start
  // fresh, Load sample, Restore backup) invalidates them: without this, the
  // Forecast page would keep showing "trained on 17 complete months" after the
  // user deleted everything. Results that arrive from an in-flight worker job
  // are also dropped if their generation no longer matches.
  const lastCount = useRef<number | null>(null)
  useEffect(() => {
    if (!store.ready) return
    const count = store.transactions.length
    const previous = lastCount.current
    lastCount.current = count
    if (previous === null) return
    const bulkChange = count === 0 || Math.abs(count - previous) > 25
    if (!bulkChange) return
    datasetGeneration.current += 1
    setML({
      classifier: null,
      forecast: null,
      anomalies: null,
      classifierRows: null,
      forecastRows: null,
      anomalyRows: null,
      trainingClassifier: false,
      forecasting: false,
      scanning: false,
    })
    autoRan.current = false
  }, [store.transactions.length, store.ready])

  // Staleness is resolved during RENDER, not by an effect: a model result is
  // only shown while the dataset it was computed from is still the dataset on
  // screen. An in-flight worker result that lands after the data changed can
  // therefore never be presented as current.
  const freshML = useMemo<MLState>(() => {
    const rows = store.transactions.length
    return {
      ...ml,
      classifier: ml.classifierRows === rows ? ml.classifier : null,
      forecast: ml.forecastRows === rows ? ml.forecast : null,
      anomalies: ml.anomalyRows === rows ? ml.anomalies : null,
    }
  }, [ml, store.transactions.length])

  const visibleAnomalies = useMemo(
    () => (freshML.anomalies?.anomalies ?? []).filter((a) => !store.ignoredAnomalyIds.includes(a.id)),
    [freshML.anomalies, store.ignoredAnomalyIds],
  )

  const pageProps = {
    ml: freshML,
    mlStatus,
    trainClassifier,
    runForecast,
    runAnomalyScan,
    predictAndApply,
    navigate,
    visibleAnomalies,
  }

  return (
    <AppShell
      route={route}
      navigate={navigate}
      theme={effectiveTheme}
      onToggleTheme={toggleTheme}
      mlStatus={mlStatus}
      alertCount={visibleAnomalies.length}
    >
      {route === 'dashboard' ? <Dashboard {...pageProps} /> : null}
      {route === 'transactions' ? <Transactions {...pageProps} /> : null}
      {route === 'insights' ? <Insights {...pageProps} /> : null}
      {route === 'forecast' ? <Forecast {...pageProps} /> : null}
      {route === 'anomalies' ? <Anomalies {...pageProps} /> : null}
      {route === 'subscriptions' ? <Subscriptions {...pageProps} /> : null}
      {route === 'budgets' ? <Budgets {...pageProps} /> : null}
      {route === 'reports' ? <Reports {...pageProps} /> : null}
      {route === 'settings' ? <SettingsPage {...pageProps} /> : null}
      <ToastViewport toasts={store.toasts} onDismiss={store.dismissToast} />
    </AppShell>
  )
}

export default function App() {
  return (
    <AppStoreProvider>
      <ConfirmProvider>
        <Inner />
      </ConfirmProvider>
    </AppStoreProvider>
  )
}
