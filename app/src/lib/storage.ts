/**
 * IndexedDB persistence with a versioned schema and ordered migrations.
 *
 * Privacy: this is the ONLY persistence layer in the app. There is no server,
 * no cloud database and no network write path for transaction data. Everything
 * below runs against the user's own browser storage.
 *
 * Every public function is defensive: a corrupted record, a blocked database or
 * an exceeded quota resolves to a typed error the UI can show, never an
 * unhandled rejection that leaves the app blank.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type AppData, type Budget, type InsightFeedback, type RecurringRule, type Settings, type Transaction } from './types'

const DB_NAME = 'finsense-ai'
const DB_VERSION = 2
const STORE_TXN = 'transactions'
const STORE_META = 'meta'

export const PREFS_KEY = 'finsense.preferences.v1'

export class StorageError extends Error {
  readonly kind: 'quota' | 'blocked' | 'corrupt' | 'unavailable' | 'unknown'
  readonly reason?: unknown

  constructor(
    message: string,
    kind: 'quota' | 'blocked' | 'corrupt' | 'unavailable' | 'unknown',
    reason?: unknown,
  ) {
    super(message)
    this.name = 'StorageError'
    this.kind = kind
    this.reason = reason
  }
}

function classify(err: unknown): StorageError {
  const name = (err as { name?: string })?.name ?? ''
  const msg = (err as { message?: string })?.message ?? String(err)
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return new StorageError(
      'Browser storage is full. Export a JSON backup, then clear old data to continue.',
      'quota',
      err,
    )
  }
  if (name === 'VersionError' || /blocked/i.test(msg)) {
    return new StorageError('Another FinSense AI tab is open with a different version. Close it and reload.', 'blocked', err)
  }
  if (name === 'InvalidStateError' || /indexeddb/i.test(msg)) {
    return new StorageError('IndexedDB is unavailable (private browsing may block it).', 'unavailable', err)
  }
  return new StorageError(msg || 'Unknown storage error', 'unknown', err)
}

let dbPromise: Promise<IDBPDatabase> | null = null

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Ordered migrations. Each step is additive so an older browser profile
        // upgrades without data loss.
        if (oldVersion < 1) {
          const store = db.createObjectStore(STORE_TXN, { keyPath: 'id' })
          store.createIndex('date', 'date')
          store.createIndex('category', 'category')
          db.createObjectStore(STORE_META)
        }
        if (oldVersion < 2) {
          // v2 added categorySource/mlConfidence; existing rows are backfilled
          // lazily by `normaliseTransaction` on read.
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
        }
      },
      blocked() {
        // Surfaced via classify() on the failing operation.
      },
    }).catch((err) => {
      dbPromise = null
      throw classify(err)
    })
  }
  return dbPromise
}

/** Repair a record read from disk so a partially-written row cannot crash the UI. */
export function normaliseTransaction(raw: unknown): Transaction | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.date !== 'string') return null
  const amount = Number(r.amountPaise)
  if (!Number.isFinite(amount)) return null
  return {
    id: r.id,
    date: r.date,
    description: typeof r.description === 'string' ? r.description : '',
    merchant: typeof r.merchant === 'string' ? r.merchant : '',
    amountPaise: Math.round(Math.abs(amount)),
    type: r.type === 'income' ? 'income' : 'expense',
    category: (typeof r.category === 'string' ? r.category : 'Other') as Transaction['category'],
    paymentMethod: (typeof r.paymentMethod === 'string' ? r.paymentMethod : 'Other') as Transaction['paymentMethod'],
    notes: typeof r.notes === 'string' ? r.notes : '',
    categorySource: (['user', 'ml', 'import', 'sample'] as const).includes(r.categorySource as never)
      ? (r.categorySource as Transaction['categorySource'])
      : 'import',
    mlConfidence: Number.isFinite(Number(r.mlConfidence)) ? Number(r.mlConfidence) : undefined,
    createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(r.updatedAt)) ? Number(r.updatedAt) : Date.now(),
  }
}

export async function loadTransactions(): Promise<{ transactions: Transaction[]; repaired: number }> {
  try {
    const db = await getDB()
    const raw = await db.getAll(STORE_TXN)
    const transactions: Transaction[] = []
    let repaired = 0
    for (const row of raw) {
      const t = normaliseTransaction(row)
      if (t) transactions.push(t)
      else repaired += 1
    }
    transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    return { transactions, repaired }
  } catch (err) {
    throw classify(err)
  }
}

export async function putTransactions(txns: Transaction[]): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_TXN, 'readwrite')
    await Promise.all(txns.map((t) => tx.store.put(t)))
    await tx.done
  } catch (err) {
    throw classify(err)
  }
}

export async function deleteTransactions(ids: string[]): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_TXN, 'readwrite')
    await Promise.all(ids.map((id) => tx.store.delete(id)))
    await tx.done
  } catch (err) {
    throw classify(err)
  }
}

export async function replaceAllTransactions(txns: Transaction[]): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction(STORE_TXN, 'readwrite')
    await tx.store.clear()
    await Promise.all(txns.map((t) => tx.store.put(t)))
    await tx.done
  } catch (err) {
    throw classify(err)
  }
}

export async function clearTransactions(): Promise<void> {
  return replaceAllTransactions([])
}

// --- meta (budgets, recurring, anomaly decisions, insight feedback) --------

async function getMeta<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDB()
    const v = await db.get(STORE_META, key)
    return (v as T) ?? fallback
  } catch {
    return fallback
  }
}

async function setMeta(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDB()
    await db.put(STORE_META, value, key)
  } catch (err) {
    throw classify(err)
  }
}

export const metaStore = {
  budgets: () => getMeta<Budget[]>('budgets', []),
  setBudgets: (v: Budget[]) => setMeta('budgets', v),
  recurring: () => getMeta<RecurringRule[]>('recurring', []),
  setRecurring: (v: RecurringRule[]) => setMeta('recurring', v),
  ignoredAnomalies: () => getMeta<string[]>('ignoredAnomalies', []),
  setIgnoredAnomalies: (v: string[]) => setMeta('ignoredAnomalies', v),
  insightFeedback: () => getMeta<InsightFeedback[]>('insightFeedback', []),
  setInsightFeedback: (v: InsightFeedback[]) => setMeta('insightFeedback', v),
}

// --- preferences in localStorage ------------------------------------------

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(settings))
  } catch {
    // Preferences are non-critical; a full localStorage must not break the app.
  }
}

// --- backup / restore -------------------------------------------------------

export function serialiseBackup(data: Omit<AppData, 'schemaVersion'>): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'FinSense AI',
      ...data,
    },
    null,
    2,
  )
}

export interface RestoreResult {
  data: AppData
  warnings: string[]
}

/** Validate and migrate a backup file. Throws a readable error for bad input. */
export function parseBackup(json: string): RestoreResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new StorageError('That file is not valid JSON.', 'corrupt')
  }
  if (!parsed || typeof parsed !== 'object') throw new StorageError('Backup file is empty or malformed.', 'corrupt')
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.transactions)) {
    throw new StorageError('Backup file has no "transactions" array - is this a FinSense AI backup?', 'corrupt')
  }

  const warnings: string[] = []
  const version = Number(obj.schemaVersion ?? 1)
  if (version > SCHEMA_VERSION) {
    warnings.push(`Backup was created by a newer version (schema ${version}); unknown fields were ignored.`)
  }

  const transactions: Transaction[] = []
  let dropped = 0
  for (const row of obj.transactions) {
    const t = normaliseTransaction(row)
    if (t) transactions.push(t)
    else dropped += 1
  }
  if (dropped) warnings.push(`${dropped} transaction row(s) were unreadable and skipped.`)

  const settings: Settings = { ...DEFAULT_SETTINGS, ...((obj.settings as Partial<Settings>) ?? {}) }

  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      transactions,
      budgets: Array.isArray(obj.budgets) ? (obj.budgets as Budget[]).filter((b) => b && typeof b.category === 'string') : [],
      recurring: Array.isArray(obj.recurring) ? (obj.recurring as RecurringRule[]) : [],
      settings,
      ignoredAnomalyIds: Array.isArray(obj.ignoredAnomalyIds) ? (obj.ignoredAnomalyIds as string[]) : [],
      insightFeedback: Array.isArray(obj.insightFeedback) ? (obj.insightFeedback as InsightFeedback[]) : [],
    },
    warnings,
  }
}

export interface StorageUsage {
  usageBytes: number
  quotaBytes: number
  ratio: number
  supported: boolean
}

export async function storageUsage(): Promise<StorageUsage> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return { usageBytes: 0, quotaBytes: 0, ratio: 0, supported: false }
    }
    const est = await navigator.storage.estimate()
    const usage = est.usage ?? 0
    const quota = est.quota ?? 0
    return { usageBytes: usage, quotaBytes: quota, ratio: quota > 0 ? usage / quota : 0, supported: true }
  } catch {
    return { usageBytes: 0, quotaBytes: 0, ratio: 0, supported: false }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
