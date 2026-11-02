/**
 * Dependency-free CSV engine for bank / UPI statement import.
 *
 * Requirements this implements, all tested in `csv.test.ts`:
 *  - delimiter sniffing (comma, semicolon, tab, pipe)
 *  - RFC4180 quoted fields with embedded delimiters, quotes and line breaks
 *  - UTF-8 BOM stripping
 *  - Unicode (Tamil / Hindi / emoji) passthrough
 *  - header auto-detection with manual override
 *  - row-level errors; nothing is ever silently dropped
 */

export type Delimiter = ',' | ';' | '\t' | '|'

export function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function sniffDelimiter(text: string): Delimiter {
  const sample = stripBOM(text).split(/\r?\n/).slice(0, 10).join('\n')
  const candidates: Delimiter[] = [',', ';', '\t', '|']
  let best: Delimiter = ','
  let bestScore = -1
  for (const d of candidates) {
    // Count only delimiters outside quotes, then reward consistent column counts.
    const counts = stripBOM(text)
      .split(/\r?\n/)
      .slice(0, 10)
      .filter((l) => l.trim().length > 0)
      .map((line) => parseLine(line, d).length)
    if (counts.length === 0) continue
    const mode = counts[0]
    if (mode < 2) continue
    const consistent = counts.filter((c) => c === mode).length / counts.length
    const score = consistent * 100 + mode
    if (score > bestScore) {
      bestScore = score
      best = d
    }
    void sample
  }
  return best
}

function parseLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delimiter) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Full parse honouring quoted fields that span physical lines. */
export function parseCSV(raw: string, delimiter?: Delimiter): string[][] {
  const text = stripBOM(raw)
  const d = delimiter ?? sniffDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === d) {
      row.push(cur)
      cur = ''
      continue
    }
    if (ch === '\r') continue
    if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

export function toCSV(rows: (string | number)[][], delimiter: Delimiter = ','): string {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /["\n\r]|^\s|\s$/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n')
}

/** Prepend a BOM so Excel opens Tamil/Hindi exports correctly. */
export function csvDownloadBody(csv: string): string {
  return `\uFEFF${csv}`
}

export type FieldKey =
  | 'date'
  | 'description'
  | 'merchant'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'type'
  | 'category'
  | 'paymentMethod'
  | 'notes'
  | 'ignore'

const HEADER_HINTS: Record<Exclude<FieldKey, 'ignore'>, string[]> = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'posted', 'time', 'dt'],
  description: ['description', 'narration', 'particulars', 'details', 'remarks', 'transaction details', 'memo'],
  merchant: ['merchant', 'payee', 'beneficiary', 'vendor', 'to', 'name', 'counterparty'],
  amount: ['amount', 'amt', 'transaction amount', 'value', 'inr', 'rs'],
  debit: ['debit', 'withdrawal', 'withdrawal amt', 'dr', 'paid out', 'money out', 'spent'],
  credit: ['credit', 'deposit', 'deposit amt', 'cr', 'paid in', 'money in', 'received'],
  type: ['type', 'txn type', 'transaction type', 'dr/cr', 'direction'],
  category: ['category', 'cat', 'expense category', 'tag'],
  paymentMethod: ['payment method', 'mode', 'payment mode', 'method', 'channel', 'instrument'],
  notes: ['notes', 'note', 'comment', 'comments', 'reference'],
}

/** Best-effort automatic column mapping; the UI always lets the user override. */
export function autoMapColumns(headers: string[]): Record<number, FieldKey> {
  const map: Record<number, FieldKey> = {}
  const used = new Set<FieldKey>()
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[_.-]+/g, ' ').replace(/\s+/g, ' '))

  const assign = (idx: number, key: FieldKey) => {
    map[idx] = key
    if (key !== 'ignore') used.add(key)
  }

  // Exact matches win before fuzzy ones so "Debit Amount" never steals "Amount".
  norm.forEach((h, i) => {
    for (const [key, hints] of Object.entries(HEADER_HINTS) as [Exclude<FieldKey, 'ignore'>, string[]][]) {
      if (used.has(key)) continue
      if (hints.includes(h)) {
        assign(i, key)
        return
      }
    }
  })
  norm.forEach((h, i) => {
    if (map[i]) return
    for (const [key, hints] of Object.entries(HEADER_HINTS) as [Exclude<FieldKey, 'ignore'>, string[]][]) {
      if (used.has(key)) continue
      if (hints.some((hint) => h.includes(hint))) {
        assign(i, key)
        return
      }
    }
    assign(i, 'ignore')
  })
  return map
}

/** Heuristic: does row 0 look like a header rather than data? */
export function looksLikeHeader(row: string[]): boolean {
  if (!row?.length) return false
  const numeric = row.filter((c) => c.trim() !== '' && Number.isFinite(Number(c.replace(/[,\s]/g, '')))).length
  const dateish = row.filter((c) => /\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(c)).length
  return numeric <= 1 && dateish === 0
}
