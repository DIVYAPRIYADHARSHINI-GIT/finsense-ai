/**
 * The single source of truth for FinSense AI.
 *
 * Every page reads transactions from this context. There is exactly one
 * transaction array in the app; dashboards, reports, forecasts, budgets and
 * insights all derive from it, which is why a single edit refreshes everything
 * at once and cannot leave a stale view behind.
 *
 * Persistence is write-through to IndexedDB, with the in-memory array updated
 * optimistically so the UI stays responsive on large imports.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  clearTransactions,
  deleteTransactions as dbDelete,
  loadSettings,
  loadTransactions,
  metaStore,
  putTransactions,
  replaceAllTransactions,
  saveSettings,
  StorageError,
} from '../lib/storage'
import { detectRecurring, mergeRecurring } from '../lib/recurring'
import { generateSampleTransactions } from '../lib/sample-data'
import { todayISO } from '../lib/dates'
import type { Budget, Category, InsightFeedback, RecurringRule, Settings, Transaction } from '../lib/types'

export interface Toast {
  id: number
  tone: 'success' | 'error' | 'info' | 'warning'
  message: string
}

interface AppStoreValue {
  ready: boolean
  loadError: string | null
  transactions: Transaction[]
  budgets: Budget[]
  recurring: RecurringRule[]
  settings: Settings
  ignoredAnomalyIds: string[]
  insightFeedback: InsightFeedback[]
  toasts: Toast[]
  today: string

  addTransaction: (t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Transaction>
  addTransactions: (ts: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) => Promise<Transaction[]>
  updateTransaction: (id: string, patch: Partial<Transaction>) => Promise<void>
  updateTransactions: (patches: { id: string; patch: Partial<Transaction> }[]) => Promise<void>
  deleteTransactions: (ids: string[]) => Promise<void>
  bulkCategorise: (ids: string[], category: Category, source?: Transaction['categorySource']) => Promise<void>

  setBudget: (category: Budget['category'], limitPaise: number) => Promise<void>
  removeBudget: (category: Budget['category']) => Promise<void>
  setRecurringStatus: (id: string, status: RecurringRule['status']) => Promise<void>
  updateRecurring: (id: string, patch: Partial<RecurringRule>) => Promise<void>
  refreshRecurring: () => Promise<void>

  updateSettings: (patch: Partial<Settings>) => void
  ignoreAnomaly: (id: string) => Promise<void>
  unignoreAnomaly: (id: string) => Promise<void>
  setInsightFeedback: (key: string, state: InsightFeedback['state'] | null) => Promise<void>

  loadSampleData: () => Promise<number>
  startFresh: () => Promise<void>
  restoreBackup: (data: {
    transactions: Transaction[]
    budgets: Budget[]
    recurring: RecurringRule[]
    settings: Settings
    ignoredAnomalyIds: string[]
    insightFeedback: InsightFeedback[]
  }) => Promise<void>

  pushToast: (tone: Toast['tone'], message: string) => void
  dismissToast: (id: number) => void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

function uid(prefix = 'txn'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [recurring, setRecurring] = useState<RecurringRule[]>([])
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [ignoredAnomalyIds, setIgnoredAnomalyIds] = useState<string[]>([])
  const [insightFeedback, setInsightFeedbackState] = useState<InsightFeedback[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(1)
  const today = todayISO()

  const pushToast = useCallback((tone: Toast['tone'], message: string) => {
    const id = toastId.current++
    setToasts((t) => [...t, { id, tone, message }])
    // Errors stay until dismissed; everything else auto-clears.
    if (tone !== 'error') {
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
    }
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const handleStorageError = useCallback(
    (err: unknown, context: string) => {
      const message = err instanceof StorageError ? err.message : `${context}: ${String(err)}`
      pushToast('error', message)
      // Re-throw so callers can keep the UI consistent if they need to.
      throw err
    },
    [pushToast],
  )

  // --- initial load --------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ transactions: txns, repaired }, b, r, ig, fb] = await Promise.all([
          loadTransactions(),
          metaStore.budgets(),
          metaStore.recurring(),
          metaStore.ignoredAnomalies(),
          metaStore.insightFeedback(),
        ])
        if (cancelled) return
        setTransactions(txns)
        setBudgets(b)
        setRecurring(r)
        setIgnoredAnomalyIds(ig)
        setInsightFeedbackState(fb)
        setReady(true)
        if (repaired > 0) {
          pushToast('warning', `${repaired} unreadable record(s) were skipped while loading your data.`)
        }
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof StorageError ? err.message : String(err))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  // --- settings persistence ------------------------------------------------
  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  // --- recurring detection: recompute whenever transactions change ----------
  // Debounced so a 700-row import triggers one detection pass, not 700.
  const recurringTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!ready) return
    if (recurringTimer.current) clearTimeout(recurringTimer.current)
    recurringTimer.current = setTimeout(() => {
      setRecurring((prev) => {
        const detected = detectRecurring(transactions, { today })
        const merged = mergeRecurring(detected, prev)
        void metaStore.setRecurring(merged).catch(() => undefined)
        return merged
      })
    }, 250)
    return () => {
      if (recurringTimer.current) clearTimeout(recurringTimer.current)
    }
  }, [transactions, ready, today])

  // --- transaction mutations ------------------------------------------------
  const addTransactions = useCallback(
    async (inputs: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      const now = Date.now()
      const created: Transaction[] = inputs.map((t) => ({ ...t, id: uid(), createdAt: now, updatedAt: now }))
      setTransactions((prev) =>
        [...created, ...prev].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
      )
      try {
        await putTransactions(created)
      } catch (err) {
        // Roll back the optimistic insert so memory matches disk.
        setTransactions((prev) => prev.filter((t) => !created.some((c) => c.id === t.id)))
        handleStorageError(err, 'Could not save transactions')
      }
      return created
    },
    [handleStorageError],
  )

  const addTransaction = useCallback(
    async (t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => {
      const [created] = await addTransactions([t])
      return created
    },
    [addTransactions],
  )

  const updateTransactions = useCallback(
    async (patches: { id: string; patch: Partial<Transaction> }[]) => {
      const map = new Map(patches.map((p) => [p.id, p.patch]))
      let updated: Transaction[] = []
      setTransactions((prev) => {
        const next = prev.map((t) => {
          const patch = map.get(t.id)
          return patch ? { ...t, ...patch, id: t.id, updatedAt: Date.now() } : t
        })
        updated = next.filter((t) => map.has(t.id))
        return next.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      })
      // `updated` is assigned synchronously by the updater above.
      try {
        if (updated.length) await putTransactions(updated)
      } catch (err) {
        handleStorageError(err, 'Could not update transactions')
      }
    },
    [handleStorageError],
  )

  const updateTransaction = useCallback(
    async (id: string, patch: Partial<Transaction>) => updateTransactions([{ id, patch }]),
    [updateTransactions],
  )

  const deleteTransactions = useCallback(
    async (ids: string[]) => {
      const removed = transactions.filter((t) => ids.includes(t.id))
      setTransactions((prev) => prev.filter((t) => !ids.includes(t.id)))
      try {
        await dbDelete(ids)
      } catch (err) {
        setTransactions((prev) => [...prev, ...removed].sort((a, b) => (a.date < b.date ? 1 : -1)))
        handleStorageError(err, 'Could not delete transactions')
      }
    },
    [transactions, handleStorageError],
  )

  const bulkCategorise = useCallback(
    async (ids: string[], category: Category, source: Transaction['categorySource'] = 'user') => {
      await updateTransactions(ids.map((id) => ({ id, patch: { category, categorySource: source, mlConfidence: undefined } })))
    },
    [updateTransactions],
  )

  // --- budgets ---------------------------------------------------------------
  const setBudget = useCallback(
    async (category: Budget['category'], limitPaise: number) => {
      const next = (() => {
        const existing = budgets.filter((b) => b.category !== category)
        return limitPaise > 0 ? [...existing, { category, limitPaise }] : existing
      })()
      setBudgets(next)
      try {
        await metaStore.setBudgets(next)
      } catch (err) {
        handleStorageError(err, 'Could not save budget')
      }
    },
    [budgets, handleStorageError],
  )

  const removeBudget = useCallback(
    async (category: Budget['category']) => setBudget(category, 0),
    [setBudget],
  )

  // --- recurring -------------------------------------------------------------
  const persistRecurring = useCallback(
    async (next: RecurringRule[]) => {
      setRecurring(next)
      try {
        await metaStore.setRecurring(next)
      } catch (err) {
        handleStorageError(err, 'Could not save recurring payments')
      }
    },
    [handleStorageError],
  )

  const setRecurringStatus = useCallback(
    async (id: string, status: RecurringRule['status']) =>
      persistRecurring(recurring.map((r) => (r.id === id ? { ...r, status } : r))),
    [recurring, persistRecurring],
  )

  const updateRecurring = useCallback(
    async (id: string, patch: Partial<RecurringRule>) =>
      persistRecurring(recurring.map((r) => (r.id === id ? { ...r, ...patch, id: r.id } : r))),
    [recurring, persistRecurring],
  )

  const refreshRecurring = useCallback(async () => {
    const detected = detectRecurring(transactions, { today })
    await persistRecurring(mergeRecurring(detected, recurring))
  }, [transactions, recurring, today, persistRecurring])

  // --- settings / anomalies / insights ---------------------------------------
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
  }, [])

  const ignoreAnomaly = useCallback(
    async (id: string) => {
      const next = [...new Set([...ignoredAnomalyIds, id])]
      setIgnoredAnomalyIds(next)
      try {
        await metaStore.setIgnoredAnomalies(next)
      } catch (err) {
        handleStorageError(err, 'Could not save your anomaly decision')
      }
    },
    [ignoredAnomalyIds, handleStorageError],
  )

  const unignoreAnomaly = useCallback(
    async (id: string) => {
      const next = ignoredAnomalyIds.filter((x) => x !== id)
      setIgnoredAnomalyIds(next)
      try {
        await metaStore.setIgnoredAnomalies(next)
      } catch (err) {
        handleStorageError(err, 'Could not save your anomaly decision')
      }
    },
    [ignoredAnomalyIds, handleStorageError],
  )

  const setInsightFeedback = useCallback(
    async (key: string, state: InsightFeedback['state'] | null) => {
      const next = insightFeedback.filter((f) => f.key !== key)
      if (state) next.push({ key, state, at: Date.now() })
      setInsightFeedbackState(next)
      try {
        await metaStore.setInsightFeedback(next)
      } catch (err) {
        handleStorageError(err, 'Could not save insight feedback')
      }
    },
    [insightFeedback, handleStorageError],
  )

  // --- dataset lifecycle -------------------------------------------------------
  const loadSampleData = useCallback(async () => {
    const sample = generateSampleTransactions({ today })
    setTransactions(sample.slice().sort((a, b) => (a.date < b.date ? 1 : -1)))
    try {
      await replaceAllTransactions(sample)
      // Sensible starting budgets so Budgets & Savings is not empty on first run.
      const starter: Budget[] = [
        { category: '__total__', limitPaise: 8000000 },
        { category: 'Food & Dining', limitPaise: 800000 },
        { category: 'Groceries', limitPaise: 900000 },
        { category: 'Shopping', limitPaise: 600000 },
        { category: 'Transportation', limitPaise: 500000 },
        { category: 'Subscriptions', limitPaise: 350000 },
      ]
      setBudgets(starter)
      await metaStore.setBudgets(starter)
      setIgnoredAnomalyIds([])
      await metaStore.setIgnoredAnomalies([])
      setInsightFeedbackState([])
      await metaStore.setInsightFeedback([])
      return sample.length
    } catch (err) {
      handleStorageError(err, 'Could not load the sample dataset')
      return 0
    }
  }, [today, handleStorageError])

  const startFresh = useCallback(async () => {
    setTransactions([])
    setBudgets([])
    setRecurring([])
    setIgnoredAnomalyIds([])
    setInsightFeedbackState([])
    try {
      await clearTransactions()
      await metaStore.setBudgets([])
      await metaStore.setRecurring([])
      await metaStore.setIgnoredAnomalies([])
      await metaStore.setInsightFeedback([])
    } catch (err) {
      handleStorageError(err, 'Could not clear your data')
    }
  }, [handleStorageError])

  const restoreBackup = useCallback<AppStoreValue['restoreBackup']>(
    async (data) => {
      setTransactions(data.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)))
      setBudgets(data.budgets)
      setRecurring(data.recurring)
      setSettings(data.settings)
      setIgnoredAnomalyIds(data.ignoredAnomalyIds)
      setInsightFeedbackState(data.insightFeedback)
      try {
        await replaceAllTransactions(data.transactions)
        await metaStore.setBudgets(data.budgets)
        await metaStore.setRecurring(data.recurring)
        await metaStore.setIgnoredAnomalies(data.ignoredAnomalyIds)
        await metaStore.setInsightFeedback(data.insightFeedback)
      } catch (err) {
        handleStorageError(err, 'Could not restore the backup')
      }
    },
    [handleStorageError],
  )

  const value = useMemo<AppStoreValue>(
    () => ({
      ready,
      loadError,
      transactions,
      budgets,
      recurring,
      settings,
      ignoredAnomalyIds,
      insightFeedback,
      toasts,
      today,
      addTransaction,
      addTransactions,
      updateTransaction,
      updateTransactions,
      deleteTransactions,
      bulkCategorise,
      setBudget,
      removeBudget,
      setRecurringStatus,
      updateRecurring,
      refreshRecurring,
      updateSettings,
      ignoreAnomaly,
      unignoreAnomaly,
      setInsightFeedback,
      loadSampleData,
      startFresh,
      restoreBackup,
      pushToast,
      dismissToast,
    }),
    [
      ready, loadError, transactions, budgets, recurring, settings, ignoredAnomalyIds, insightFeedback,
      toasts, today, addTransaction, addTransactions, updateTransaction, updateTransactions,
      deleteTransactions, bulkCategorise, setBudget, removeBudget, setRecurringStatus, updateRecurring,
      refreshRecurring, updateSettings, ignoreAnomaly, unignoreAnomaly, setInsightFeedback,
      loadSampleData, startFresh, restoreBackup, pushToast, dismissToast,
    ],
  )

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext)
  if (!ctx) throw new Error('useAppStore must be used inside AppStoreProvider')
  return ctx
}
