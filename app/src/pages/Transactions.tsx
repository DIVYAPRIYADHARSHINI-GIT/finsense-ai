/**
 * Transactions - full CRUD, search, filter, sort, bulk actions, CSV in/out.
 *
 * The CSV importer is a three-step wizard (upload -> map columns -> preview)
 * that reports successful / skipped / failed counts with row-level messages.
 * No input row is ever silently dropped.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpDown,
  Brain,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileDown,
  Filter,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Modal,
  Select,
  TextArea,
  TextInput,
  useConfirm,
} from '../components/ui'
import { useAppStore } from '../store/AppStore'
import {
  autoMapColumns,
  csvDownloadBody,
  looksLikeHeader,
  parseCSV,
  sniffDelimiter,
  toCSV,
  type Delimiter,
  type FieldKey,
} from '../lib/csv'
import {
  SAMPLE_CSV_HEADERS,
  SAMPLE_CSV_ROWS,
  dedupeKey,
  inferDayFirst,
  mapRowsToTransactions,
  type ImportResult,
} from '../lib/import'
import { formatDate, isValidISO, todayISO } from '../lib/dates'
import { formatMoney, toMajor, toPaise } from '../lib/money'
import { findDuplicates } from '../lib/analytics'
import { CATEGORIES, PAYMENT_METHODS, type Category, type PaymentMethod, type Transaction, type TxnType } from '../lib/types'
import type { PageProps } from './types'

type SortKey = 'date' | 'amountPaise'

function download(filename: string, body: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([body], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// Add / edit dialog
// ---------------------------------------------------------------------------

interface DraftTxn {
  date: string
  description: string
  merchant: string
  amount: string
  type: TxnType
  category: Category
  paymentMethod: PaymentMethod
  notes: string
}

function emptyDraft(): DraftTxn {
  return {
    date: todayISO(),
    description: '',
    merchant: '',
    amount: '',
    type: 'expense',
    category: 'Other',
    paymentMethod: 'UPI',
    notes: '',
  }
}

function TransactionDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean
  onClose: () => void
  editing: Transaction | null
}) {
  const store = useAppStore()
  const [draft, setDraft] = useState<DraftTxn>(emptyDraft)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setDraft(
      editing
        ? {
            date: editing.date,
            description: editing.description,
            merchant: editing.merchant,
            amount: String(toMajor(editing.amountPaise)),
            type: editing.type,
            category: editing.category,
            paymentMethod: editing.paymentMethod,
            notes: editing.notes,
          }
        : emptyDraft(),
    )
  }, [open, editing])

  const submit = async () => {
    const next: Record<string, string> = {}
    if (!isValidISO(draft.date)) next.date = 'Enter a valid date'
    const amount = Number(draft.amount)
    if (!draft.amount.trim()) next.amount = 'Amount is required'
    else if (!Number.isFinite(amount) || amount <= 0) next.amount = 'Enter a positive amount'
    if (!draft.merchant.trim() && !draft.description.trim()) {
      next.merchant = 'Provide a merchant or a description'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    const payload = {
      date: draft.date,
      description: draft.description.trim(),
      merchant: draft.merchant.trim(),
      amountPaise: toPaise(amount),
      type: draft.type,
      category: draft.category,
      paymentMethod: draft.paymentMethod,
      notes: draft.notes.trim(),
      categorySource: 'user' as const,
    }

    if (editing) {
      await store.updateTransaction(editing.id, payload)
      store.pushToast('success', 'Transaction updated.')
    } else {
      // Warn about an exact duplicate instead of creating one silently.
      const key = dedupeKey(payload)
      const dup = store.transactions.find((t) => dedupeKey(t) === key)
      if (dup) {
        setErrors({ merchant: 'An identical transaction already exists on this date. Change a field or edit the existing row.' })
        return
      }
      await store.addTransaction(payload)
      store.pushToast('success', 'Transaction added.')
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit transaction' : 'Add transaction'}
      description={editing ? `ID ${editing.id}` : 'Amounts are stored in minor units so totals never drift.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} icon={Check}>
            {editing ? 'Save changes' : 'Add transaction'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Transaction date" required error={errors.date}>
          <TextInput type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </Field>
        <Field label="Amount" required error={errors.amount} hint="Positive number; direction is set by Type">
          <TextInput
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            placeholder="0.00"
          />
        </Field>
        <Field label="Merchant name" error={errors.merchant}>
          <TextInput
            value={draft.merchant}
            onChange={(e) => setDraft({ ...draft, merchant: e.target.value })}
            placeholder="FreshCart Supermarket"
          />
        </Field>
        <Field label="Transaction type" required>
          <Select
            value={draft.type}
            onChange={(e) => {
              const type = e.target.value as TxnType
              setDraft({ ...draft, type, category: type === 'income' ? 'Salary' : draft.category === 'Salary' ? 'Other' : draft.category })
            }}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </Select>
        </Field>
        <Field label="Category" required>
          <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment method">
          <Select
            value={draft.paymentMethod}
            onChange={(e) => setDraft({ ...draft, paymentMethod: e.target.value as PaymentMethod })}
          >
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" hint="The raw bank or UPI narration helps the classifier">
            <TextInput
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="UPI/DR/402938471/FRESHCART SUPERMARKET"
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <TextArea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// CSV import wizard
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<FieldKey, string> = {
  date: 'Transaction date',
  description: 'Description / narration',
  merchant: 'Merchant',
  amount: 'Amount (signed)',
  debit: 'Debit / withdrawal',
  credit: 'Credit / deposit',
  type: 'Type (Dr/Cr)',
  category: 'Category',
  paymentMethod: 'Payment method',
  notes: 'Notes',
  ignore: 'Ignore this column',
}

function ImportWizard({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (ids: string[]) => void }) {
  const store = useAppStore()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<Record<number, FieldKey>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep(1)
    setFileName('')
    setRows([])
    setMapping({})
    setResult(null)
    setParseError(null)
    setBusy(false)
  }

  const handleFile = async (file: File) => {
    setParseError(null)
    try {
      if (file.size > 20 * 1024 * 1024) {
        setParseError('That file is larger than 20 MB. Split it into smaller statements first.')
        return
      }
      const text = await file.text()
      if (!text.trim()) {
        setParseError('That file is empty.')
        return
      }
      const d = sniffDelimiter(text)
      const parsed = parseCSV(text, d)
      if (parsed.length === 0) {
        setParseError('No rows could be read from that file.')
        return
      }
      const header = looksLikeHeader(parsed[0])
      setFileName(file.name)
      setDelimiter(d)
      setRows(parsed)
      setHasHeader(header)
      setMapping(autoMapColumns(header ? parsed[0] : parsed[0].map((_, i) => `Column ${i + 1}`)))
      setStep(2)
    } catch (err) {
      setParseError(`Could not read the file: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const reparse = (d: Delimiter) => {
    // Re-split with a user-chosen delimiter when sniffing guessed wrong.
    const text = rows.map((r) => r.join(delimiter)).join('\n')
    const parsed = parseCSV(text, d)
    setDelimiter(d)
    setRows(parsed)
    setMapping(autoMapColumns(hasHeader ? parsed[0] : parsed[0].map((_, i) => `Column ${i + 1}`)))
  }

  const buildPreview = () => {
    const existingKeys = new Set(store.transactions.map((t) => dedupeKey(t)))
    const res = mapRowsToTransactions(rows, { mapping, hasHeader, existingKeys })
    setResult(res)
    setStep(3)
  }

  const commit = async () => {
    if (!result?.rows.length) return
    setBusy(true)
    try {
      const created = await store.addTransactions(result.rows.map((r) => r.txn))
      store.pushToast(
        'success',
        `Imported ${created.length} transaction(s). ${result.skipped.length} skipped, ${result.failed.length} failed.`,
      )
      onImported(created.filter((c) => c.categorySource === 'ml').map((c) => c.id))
      reset()
      onClose()
    } catch {
      // The store already surfaced a toast; keep the wizard open for a retry.
      setBusy(false)
    }
  }

  const headerCells = hasHeader ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`)
  const dateCol = Number(Object.keys(mapping).find((k) => mapping[Number(k)] === 'date') ?? -1)
  const dayFirst =
    dateCol >= 0 ? inferDayFirst((hasHeader ? rows.slice(1) : rows).map((r) => r[dateCol] ?? '')) : true
  const hasDate = Object.values(mapping).includes('date')
  const hasAmount =
    Object.values(mapping).includes('amount') ||
    Object.values(mapping).includes('debit') ||
    Object.values(mapping).includes('credit')

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Import transactions from CSV"
      description={
        step === 1
          ? 'Your file is read entirely in this browser and is never uploaded anywhere.'
          : step === 2
            ? `${fileName} - map each column to a field`
            : `${fileName} - review before saving`
      }
      size="xl"
      footer={
        step === 1 ? (
          <Button
            variant="ghost"
            icon={FileDown}
            onClick={() => download('finsense-sample-transactions.csv', csvDownloadBody(toCSV([SAMPLE_CSV_HEADERS, ...SAMPLE_CSV_ROWS])))}
          >
            Download sample CSV
          </Button>
        ) : step === 2 ? (
          <>
            <Button variant="ghost" onClick={reset}>
              Choose another file
            </Button>
            <Button variant="primary" onClick={buildPreview} disabled={!hasDate || !hasAmount}>
              Preview import
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back to mapping
            </Button>
            <Button variant="primary" onClick={() => void commit()} loading={busy} disabled={!result?.rows.length} icon={Upload}>
              Import {result?.rows.length ?? 0} transaction(s)
            </Button>
          </>
        )
      }
    >
      {/* ---- step 1: file ---- */}
      {step === 1 ? (
        <div>
          <div
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center"
            style={{ borderColor: 'var(--line-strong)', background: 'var(--surface-sunken)' }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) void handleFile(f)
            }}
          >
            <Upload size={26} style={{ color: 'var(--ink-subtle)' }} aria-hidden />
            <p className="mt-3 text-[14px] font-medium" style={{ color: 'var(--ink)' }}>
              Drop a bank or UPI statement here
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              CSV with comma, semicolon, tab or pipe delimiters. UTF-8 BOM, quoted fields and Tamil/Hindi text supported.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
                e.target.value = ''
              }}
            />
            <Button variant="primary" className="mt-5" onClick={() => fileRef.current?.click()} icon={Upload}>
              Choose CSV file
            </Button>
          </div>
          {parseError ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: 'var(--danger-soft)', color: 'var(--danger-ink)' }} role="alert">
              <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
              {parseError}
            </p>
          ) : null}
          <div className="mt-5 rounded-lg px-4 py-3" style={{ background: 'var(--accent-soft)' }}>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--accent-ink)' }}>
              FinSense AI never asks for bank passwords, UPI PINs, OTPs or card numbers. Export a statement from your
              bank's website and import the file here.
            </p>
          </div>
        </div>
      ) : null}

      {/* ---- step 2: mapping ---- */}
      {step === 2 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Delimiter">
              <Select
                value={delimiter}
                onChange={(e) => reparse(e.target.value as Delimiter)}
                className="!w-auto"
                aria-label="CSV delimiter"
              >
                <option value=",">Comma ,</option>
                <option value=";">Semicolon ;</option>
                <option value={'\t'}>Tab</option>
                <option value="|">Pipe |</option>
              </Select>
            </Field>
            <label className="flex h-10 items-center gap-2 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => {
                  setHasHeader(e.target.checked)
                  setMapping(autoMapColumns(e.target.checked ? rows[0] ?? [] : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`)))
                }}
                className="size-4 rounded"
              />
              First row is a header
            </label>
            <p className="ml-auto text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
              {rows.length} row(s), {headerCells.length} column(s)
              {dateCol >= 0 ? ` - dates read as ${dayFirst ? 'DD/MM' : 'MM/DD'}` : ''}
            </p>
          </div>

          {!hasDate || !hasAmount ? (
            <p className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: 'var(--warning-soft)', color: 'var(--warning-ink)' }}>
              <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
              Map at least a <strong>date</strong> column and one of <strong>amount</strong>, <strong>debit</strong> or{' '}
              <strong>credit</strong> to continue.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr style={{ background: 'var(--surface-sunken)' }}>
                  {headerCells.map((h, i) => (
                    <th key={i} className="min-w-[150px] p-2 text-left align-top">
                      <span className="mb-1.5 block truncate font-semibold" style={{ color: 'var(--ink)' }} title={h}>
                        {h || `Column ${i + 1}`}
                      </span>
                      <Select
                        value={mapping[i] ?? 'ignore'}
                        onChange={(e) => setMapping({ ...mapping, [i]: e.target.value as FieldKey })}
                        className="!h-8 !text-[12px]"
                        aria-label={`Map column ${h || i + 1}`}
                      >
                        {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
                          <option key={k} value={k}>
                            {FIELD_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(hasHeader ? rows.slice(1, 6) : rows.slice(0, 5)).map((r, ri) => (
                  <tr key={ri} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    {headerCells.map((_, ci) => (
                      <td key={ci} className="max-w-[220px] truncate p-2" style={{ color: 'var(--ink-muted)' }} title={r[ci]}>
                        {r[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ---- step 3: preview ---- */}
      {step === 3 && result ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Ready to import', value: result.rows.length, tone: 'success' as const },
              { label: 'Skipped', value: result.skipped.length, tone: 'warning' as const },
              { label: 'Failed', value: result.failed.length, tone: 'danger' as const },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg px-3 py-2.5"
                style={{
                  background:
                    s.tone === 'success' ? 'var(--success-soft)' : s.tone === 'warning' ? 'var(--warning-soft)' : 'var(--danger-soft)',
                }}
              >
                <p
                  className="tnum text-[20px] font-semibold leading-none"
                  style={{
                    color:
                      s.tone === 'success' ? 'var(--success-ink)' : s.tone === 'warning' ? 'var(--warning-ink)' : 'var(--danger-ink)',
                  }}
                >
                  {s.value}
                </p>
                <p className="mt-1 text-[11.5px] font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          {result.rows.length ? (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-subtle)' }}>
                Preview (first 10 of {result.rows.length})
              </p>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                      <th className="p-2 text-left font-semibold">Row</th>
                      <th className="p-2 text-left font-semibold">Date</th>
                      <th className="p-2 text-left font-semibold">Merchant</th>
                      <th className="p-2 text-right font-semibold">Amount</th>
                      <th className="p-2 text-left font-semibold">Type</th>
                      <th className="p-2 text-left font-semibold">Category</th>
                      <th className="p-2 text-left font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 10).map((r) => (
                      <tr key={r.rowNumber} className="border-t" style={{ borderColor: 'var(--line)' }}>
                        <td className="tnum p-2" style={{ color: 'var(--ink-subtle)' }}>
                          {r.rowNumber}
                        </td>
                        <td className="p-2" style={{ color: 'var(--ink-muted)' }}>
                          {r.txn.date}
                        </td>
                        <td className="max-w-[180px] truncate p-2" style={{ color: 'var(--ink)' }}>
                          {r.txn.merchant || r.txn.description}
                        </td>
                        <td className="tnum p-2 text-right font-medium" style={{ color: 'var(--ink)' }}>
                          {formatMoney(r.txn.amountPaise, store.settings.currency)}
                        </td>
                        <td className="p-2">
                          <Badge tone={r.txn.type === 'income' ? 'success' : 'neutral'}>{r.txn.type}</Badge>
                        </td>
                        <td className="p-2" style={{ color: 'var(--ink-muted)' }}>
                          {r.txn.categorySource === 'ml' ? <Badge tone="accent">predict</Badge> : r.txn.category}
                        </td>
                        <td className="max-w-[200px] p-2 text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                          {r.warnings.join('; ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {result.failed.length ? (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--danger-ink)' }}>
                Failed rows - not imported
              </p>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg px-3 py-2.5" style={{ background: 'var(--danger-soft)' }}>
                {result.failed.slice(0, 25).map((f) => (
                  <li key={f.rowNumber} className="text-[12.5px]" style={{ color: 'var(--danger-ink)' }}>
                    <span className="tnum font-semibold">Row {f.rowNumber}:</span> {f.errors.join('; ')}
                  </li>
                ))}
                {result.failed.length > 25 ? (
                  <li className="text-[12px] italic" style={{ color: 'var(--danger-ink)' }}>
                    ...and {result.failed.length - 25} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {result.skipped.length ? (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--warning-ink)' }}>
                Skipped rows
              </p>
              <ul className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg px-3 py-2.5" style={{ background: 'var(--warning-soft)' }}>
                {result.skipped.slice(0, 20).map((s) => (
                  <li key={s.rowNumber} className="text-[12.5px]" style={{ color: 'var(--warning-ink)' }}>
                    <span className="tnum font-semibold">Row {s.rowNumber}:</span> {s.reason}
                  </li>
                ))}
                {result.skipped.length > 20 ? (
                  <li className="text-[12px] italic" style={{ color: 'var(--warning-ink)' }}>
                    ...and {result.skipped.length - 20} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Transactions({ ml, predictAndApply, trainClassifier }: PageProps) {
  const store = useAppStore()
  const confirm = useConfirm()
  const { transactions, settings } = store

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [methodFilter, setMethodFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkCategory, setBulkCategory] = useState<Category>('Other')
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = minAmount.trim() ? toPaise(minAmount) : null
    const max = maxAmount.trim() ? toPaise(maxAmount) : null
    const rows = transactions.filter((t) => {
      if (q) {
        const hay = `${t.merchant} ${t.description} ${t.notes} ${t.category} ${t.paymentMethod}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
      if (methodFilter !== 'all' && t.paymentMethod !== methodFilter) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (fromDate && t.date < fromDate) return false
      if (toDate && t.date > toDate) return false
      if (min !== null && t.amountPaise < min) return false
      if (max !== null && t.amountPaise > max) return false
      return true
    })
    rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'amountPaise') return (a.amountPaise - b.amountPaise) * dir
      return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir
    })
    return rows
  }, [transactions, search, categoryFilter, methodFilter, typeFilter, fromDate, toDate, minAmount, maxAmount, sortKey, sortDir])

  // Paging and selection are DERIVED during render rather than corrected by an
  // effect. Clamping the page here means a filter change can never leave the
  // user on page 4 of a 3-page list, and intersecting the selection here means
  // a deleted or filtered-out row can never stay selected - both without the
  // extra render pass (and flash of stale rows) that a setState-in-effect
  // would cause.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const visibleIds = useMemo(() => new Set(filtered.map((t) => t.id)), [filtered])
  const activeSelection = useMemo(
    () => new Set([...selected].filter((id) => visibleIds.has(id))),
    [selected, visibleIds],
  )

  const duplicates = useMemo(() => findDuplicates(transactions), [transactions])
  const uncertain = useMemo(
    () => transactions.filter((t) => t.categorySource === 'ml' && (t.mlConfidence ?? 1) < 0.55),
    [transactions],
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exportCSV = () => {
    const rows: (string | number)[][] = [
      ['Transaction ID', 'Date', 'Description', 'Merchant', 'Amount', 'Type', 'Category', 'Payment Method', 'Notes', 'Category Source', 'ML Confidence'],
      ...filtered.map((t) => [
        t.id,
        t.date,
        t.description,
        t.merchant,
        toMajor(t.amountPaise).toFixed(2),
        t.type,
        t.category,
        t.paymentMethod,
        t.notes,
        t.categorySource,
        t.mlConfidence !== undefined ? t.mlConfidence.toFixed(4) : '',
      ]),
    ]
    download(`finsense-transactions-${todayISO()}.csv`, csvDownloadBody(toCSV(rows)))
    store.pushToast('success', `Exported ${filtered.length} transaction(s).`)
  }

  const bulkDelete = async () => {
    const ids = [...activeSelection]
    const ok = await confirm({
      title: `Delete ${ids.length} transaction(s)?`,
      message: 'This permanently removes them from this browser. Export a backup first if you might need them.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await store.deleteTransactions(ids)
    setSelected(new Set())
    store.pushToast('success', `Deleted ${ids.length} transaction(s).`)
  }

  const removeDuplicates = async () => {
    // Keep the first of each duplicate group, drop the rest.
    const ids = duplicates.flatMap((g) => g.slice(1).map((t) => t.id))
    const ok = await confirm({
      title: `Remove ${ids.length} duplicate transaction(s)?`,
      message: `${duplicates.length} group(s) of identical date + amount + description were found. The first row of each group is kept.`,
      confirmLabel: 'Remove duplicates',
      tone: 'danger',
    })
    if (!ok) return
    await store.deleteTransactions(ids)
    store.pushToast('success', `Removed ${ids.length} duplicate(s).`)
  }

  return (
    <div className="space-y-4">
      {/* ---- toolbar ---- */}
      <Card className="p-4" as="div">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-subtle)' }}
              aria-hidden
            />
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, description, notes..."
              className="!pl-9"
              aria-label="Search transactions"
            />
          </div>
          <Button variant="secondary" icon={Filter} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filters
          </Button>
          <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
          <Button variant="secondary" icon={Download} onClick={exportCSV} disabled={!filtered.length}>
            Export
          </Button>
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            Add
          </Button>
        </div>

        {showFilters ? (
          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4" style={{ borderColor: 'var(--line)' }}>
            <Field label="Category">
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment method">
              <Select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
                <option value="all">All methods</option>
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">Income and expenses</option>
                <option value="expense">Expenses only</option>
                <option value="income">Income only</option>
              </Select>
            </Field>
            <Field label="Sort by">
              <Select
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split(':')
                  setSortKey(k as SortKey)
                  setSortDir(d as 'asc' | 'desc')
                }}
              >
                <option value="date:desc">Date, newest first</option>
                <option value="date:asc">Date, oldest first</option>
                <option value="amountPaise:desc">Amount, highest first</option>
                <option value="amountPaise:asc">Amount, lowest first</option>
              </Select>
            </Field>
            <Field label="From date">
              <TextInput type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
            </Field>
            <Field label="To date">
              <TextInput type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
            </Field>
            <Field label="Min amount">
              <TextInput type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Max amount">
              <TextInput type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="Any" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={() => {
                  setCategoryFilter('all')
                  setMethodFilter('all')
                  setTypeFilter('all')
                  setFromDate('')
                  setToDate('')
                  setMinAmount('')
                  setMaxAmount('')
                  setSearch('')
                }}
              >
                Clear all filters
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* ---- data-quality banners ---- */}
      {duplicates.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" as="div">
          <p className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--warning-ink)' }}>
            <Copy size={15} aria-hidden />
            {duplicates.length} group(s) of duplicate transactions detected.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void removeDuplicates()}>
            Review and remove
          </Button>
        </Card>
      ) : null}

      {uncertain.length > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" as="div">
          <p className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--warning-ink)' }}>
            <AlertTriangle size={15} aria-hidden />
            {uncertain.length} transaction(s) were classified with low confidence and need review.
          </p>
          <Button size="sm" variant="secondary" onClick={() => { setSearch(''); setCategoryFilter('all'); setSelected(new Set(uncertain.map((t) => t.id))) }}>
            Select them
          </Button>
        </Card>
      ) : null}

      {/* ---- bulk bar ---- */}
      {activeSelection.size > 0 ? (
        <Card className="flex flex-wrap items-center gap-2 px-4 py-3" as="div">
          <span className="tnum text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
            {activeSelection.size} selected
          </span>
          <Select
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value as Category)}
            className="!h-9 !w-auto !text-[13px]"
            aria-label="Bulk category"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            icon={CheckCheck}
            onClick={async () => {
              await store.bulkCategorise([...activeSelection], bulkCategory)
              store.pushToast('success', `${activeSelection.size} transaction(s) categorised as ${bulkCategory}.`)
              setSelected(new Set())
            }}
          >
            Apply category
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={Brain}
            loading={ml.trainingClassifier}
            onClick={() => void predictAndApply([...activeSelection])}
          >
            Classify with ML
          </Button>
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => void bulkDelete()}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </Card>
      ) : null}

      {/* ---- table ---- */}
      <Card>
        <CardHeader
          title={`${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`}
          description={
            filtered.length !== transactions.length ? `Filtered from ${transactions.length} stored` : 'All stored transactions'
          }
          icon={Receipt}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon={Brain}
              loading={ml.trainingClassifier}
              onClick={() => void trainClassifier()}
            >
              {ml.classifier?.ok ? `Retrain (${((ml.classifier.testAccuracy ?? 0) * 100).toFixed(0)}%)` : 'Train classifier'}
            </Button>
          }
        />

        {filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title={transactions.length ? 'No transactions match these filters' : 'No transactions yet'}
            description={
              transactions.length
                ? 'Try clearing the search box or widening the date and amount ranges.'
                : 'Add a transaction manually or import a bank/UPI CSV to begin.'
            }
            action={
              transactions.length ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setCategoryFilter('all')
                    setMethodFilter('all')
                    setTypeFilter('all')
                    setFromDate('')
                    setToDate('')
                    setMinAmount('')
                    setMaxAmount('')
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setDialogOpen(true) }}>
                  Add transaction
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-muted)' }}>
                    <th className="w-10 p-3">
                      <input
                        type="checkbox"
                        className="size-4 rounded"
                        aria-label="Select all visible transactions"
                        checked={pageRows.length > 0 && pageRows.every((t) => activeSelection.has(t.id))}
                        onChange={(e) => {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            for (const t of pageRows) {
                              if (e.target.checked) next.add(t.id)
                              else next.delete(t.id)
                            }
                            return next
                          })
                        }}
                      />
                    </th>
                    <th className="p-3 text-left font-semibold">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={() => {
                          setSortKey('date')
                          setSortDir(sortKey === 'date' && sortDir === 'desc' ? 'asc' : 'desc')
                        }}
                      >
                        Date <ArrowUpDown size={12} aria-hidden />
                      </button>
                    </th>
                    <th className="p-3 text-left font-semibold">Merchant / description</th>
                    <th className="p-3 text-left font-semibold">Category</th>
                    <th className="p-3 text-left font-semibold">Method</th>
                    <th className="p-3 text-right font-semibold">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        onClick={() => {
                          setSortKey('amountPaise')
                          setSortDir(sortKey === 'amountPaise' && sortDir === 'desc' ? 'asc' : 'desc')
                        }}
                      >
                        Amount <ArrowUpDown size={12} aria-hidden />
                      </button>
                    </th>
                    <th className="w-20 p-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t transition-colors"
                      style={{ borderColor: 'var(--line)', background: activeSelection.has(t.id) ? 'var(--accent-soft)' : undefined }}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          className="size-4 rounded"
                          checked={activeSelection.has(t.id)}
                          onChange={() => toggle(t.id)}
                          aria-label={`Select transaction from ${t.date}`}
                        />
                      </td>
                      <td className="tnum whitespace-nowrap p-3" style={{ color: 'var(--ink-muted)' }}>
                        {formatDate(t.date, settings.dateFormat)}
                      </td>
                      <td className="max-w-[280px] p-3">
                        <p className="truncate font-medium" style={{ color: 'var(--ink)' }}>
                          {t.merchant || t.description || 'Untitled'}
                        </p>
                        {t.merchant && t.description ? (
                          <p className="truncate text-[11.5px]" style={{ color: 'var(--ink-subtle)' }} title={t.description}>
                            {t.description}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span style={{ color: 'var(--ink-muted)' }}>{t.category}</span>
                          {t.categorySource === 'ml' ? (
                            <Badge tone={(t.mlConfidence ?? 1) < 0.55 ? 'warning' : 'accent'}>
                              {(t.mlConfidence ?? 1) < 0.55 ? 'Review' : `${Math.round((t.mlConfidence ?? 0) * 100)}%`}
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="p-3" style={{ color: 'var(--ink-subtle)' }}>
                        {t.paymentMethod}
                      </td>
                      <td
                        className="tnum whitespace-nowrap p-3 text-right font-semibold"
                        style={{ color: t.type === 'income' ? 'var(--success-ink)' : 'var(--ink)' }}
                      >
                        {t.type === 'income' ? '+' : '-'}
                        {formatMoney(t.amountPaise, settings.currency)}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(t)
                              setDialogOpen(true)
                            }}
                            aria-label={`Edit transaction from ${t.date}`}
                            className="rounded p-1.5 transition-colors hover:opacity-70"
                            style={{ color: 'var(--ink-subtle)' }}
                          >
                            <Pencil size={14} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Delete this transaction?',
                                message: `${t.merchant || t.description} - ${formatMoney(t.amountPaise, settings.currency)} on ${formatDate(t.date, settings.dateFormat)}`,
                                confirmLabel: 'Delete',
                                tone: 'danger',
                              })
                              if (ok) {
                                await store.deleteTransactions([t.id])
                                store.pushToast('success', 'Transaction deleted.')
                              }
                            }}
                            aria-label={`Delete transaction from ${t.date}`}
                            className="rounded p-1.5 transition-colors hover:opacity-70"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards */}
            <ul className="divide-y md:hidden" style={{ borderColor: 'var(--line)' }}>
              {pageRows.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 rounded"
                    checked={activeSelection.has(t.id)}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select transaction from ${t.date}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[13.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {t.merchant || t.description || 'Untitled'}
                      </p>
                      <span
                        className="tnum shrink-0 text-[13.5px] font-semibold"
                        style={{ color: t.type === 'income' ? 'var(--success-ink)' : 'var(--ink)' }}
                      >
                        {t.type === 'income' ? '+' : '-'}
                        {formatMoney(t.amountPaise, settings.currency)}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
                      <span className="tnum">{formatDate(t.date, settings.dateFormat)}</span>
                      <span aria-hidden>-</span>
                      <span>{t.category}</span>
                      <span aria-hidden>-</span>
                      <span>{t.paymentMethod}</span>
                      {t.categorySource === 'ml' ? (
                        <Badge tone={(t.mlConfidence ?? 1) < 0.55 ? 'warning' : 'accent'}>
                          {(t.mlConfidence ?? 1) < 0.55 ? 'Review' : `ML ${Math.round((t.mlConfidence ?? 0) * 100)}%`}
                        </Badge>
                      ) : null}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setEditing(t); setDialogOpen(true) }}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Delete this transaction?',
                            message: `${t.merchant || t.description} - ${formatMoney(t.amountPaise, settings.currency)}`,
                            confirmLabel: 'Delete',
                            tone: 'danger',
                          })
                          if (ok) {
                            await store.deleteTransactions([t.id])
                            store.pushToast('success', 'Transaction deleted.')
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 ? (
              <div
                className="flex items-center justify-between gap-3 border-t px-4 py-3"
                style={{ borderColor: 'var(--line)' }}
              >
                <p className="tnum text-[12.5px]" style={{ color: 'var(--ink-subtle)' }}>
                  Page {safePage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editing={editing} />
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(ids) => {
          if (ids.length) void predictAndApply(ids)
        }}
      />
    </div>
  )
}
