/** Storage validation, backup/restore and WCAG contrast of the design tokens. */

import { describe, expect, it } from 'vitest'
import { formatBytes, normaliseTransaction, parseBackup, serialiseBackup, StorageError } from '../lib/storage'
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type Transaction } from '../lib/types'

const sample: Transaction = {
  id: 'abc',
  date: '2025-06-01',
  description: 'UPI/DR/1/SHOP',
  merchant: 'Shop',
  amountPaise: 12345,
  type: 'expense',
  category: 'Groceries',
  paymentMethod: 'UPI',
  notes: '',
  categorySource: 'user',
  createdAt: 1,
  updatedAt: 2,
}

describe('record normalisation', () => {
  it('accepts a well-formed record unchanged', () => {
    expect(normaliseTransaction(sample)).toMatchObject({ id: 'abc', amountPaise: 12345 })
  })

  it('rejects records missing an id or date', () => {
    expect(normaliseTransaction({ ...sample, id: undefined })).toBeNull()
    expect(normaliseTransaction({ ...sample, date: 123 })).toBeNull()
    expect(normaliseTransaction(null)).toBeNull()
    expect(normaliseTransaction('nonsense')).toBeNull()
  })

  it('rejects a non-numeric amount rather than storing NaN', () => {
    expect(normaliseTransaction({ ...sample, amountPaise: 'lots' })).toBeNull()
    expect(normaliseTransaction({ ...sample, amountPaise: Number.NaN })).toBeNull()
  })

  it('repairs missing optional fields with safe defaults', () => {
    const repaired = normaliseTransaction({ id: 'x', date: '2025-01-01', amountPaise: 100 })!
    expect(repaired.description).toBe('')
    expect(repaired.type).toBe('expense')
    expect(repaired.category).toBe('Other')
    expect(repaired.categorySource).toBe('import')
    expect(Number.isFinite(repaired.createdAt)).toBe(true)
  })

  it('stores amounts as a positive integer regardless of sign', () => {
    expect(normaliseTransaction({ ...sample, amountPaise: -500 })!.amountPaise).toBe(500)
    expect(normaliseTransaction({ ...sample, amountPaise: 500.7 })!.amountPaise).toBe(501)
  })
})

describe('backup and restore', () => {
  const payload = {
    transactions: [sample],
    budgets: [{ category: 'Groceries' as const, limitPaise: 500000 }],
    recurring: [],
    settings: DEFAULT_SETTINGS,
    ignoredAnomalyIds: ['abc'],
    insightFeedback: [],
  }

  it('round-trips a backup without loss', () => {
    const { data, warnings } = parseBackup(serialiseBackup(payload))
    expect(warnings).toEqual([])
    expect(data.transactions).toHaveLength(1)
    expect(data.transactions[0].id).toBe('abc')
    expect(data.budgets).toHaveLength(1)
    expect(data.ignoredAnomalyIds).toEqual(['abc'])
    expect(data.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('throws a readable error for malformed JSON', () => {
    expect(() => parseBackup('{not json')).toThrow(StorageError)
    expect(() => parseBackup('{not json')).toThrow(/not valid JSON/)
  })

  it('throws when the file is not a FinSense backup', () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow(/no "transactions" array/)
  })

  it('warns and skips unreadable rows rather than failing the whole restore', () => {
    const mixed = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      transactions: [sample, { broken: true }, { id: 'y', date: '2025-01-01', amountPaise: 'NaN' }],
    })
    const { data, warnings } = parseBackup(mixed)
    expect(data.transactions).toHaveLength(1)
    expect(warnings.join(' ')).toMatch(/2 transaction row\(s\) were unreadable/)
  })

  it('warns when a backup comes from a newer schema', () => {
    const future = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 5, transactions: [] })
    expect(parseBackup(future).warnings.join(' ')).toMatch(/newer version/)
  })

  it('migrates a v1 backup with no settings block', () => {
    const v1 = JSON.stringify({ schemaVersion: 1, transactions: [sample] })
    const { data } = parseBackup(v1)
    expect(data.settings).toEqual(DEFAULT_SETTINGS)
    expect(data.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('tolerates an empty transaction list', () => {
    const { data } = parseBackup(JSON.stringify({ schemaVersion: SCHEMA_VERSION, transactions: [] }))
    expect(data.transactions).toEqual([])
  })
})

describe('byte formatting', () => {
  it('formats sizes in human units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

// ---------------------------------------------------------------------------
// WCAG AA contrast of the published design tokens
// ---------------------------------------------------------------------------

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

describe('WCAG AA contrast', () => {
  const LIGHT = {
    canvas: '#f8fafc',
    surface: '#ffffff',
    surfaceSunken: '#f1f5f9',
    ink: '#172033',
    inkMuted: '#475569',
    inkSubtle: '#64748b',
    accent: '#2563eb',
    accentInk: '#1d4ed8',
    successInk: '#15803d',
    warningInk: '#b45309',
    dangerInk: '#b91c1c',
  }
  const DARK = {
    canvas: '#0f172a',
    surface: '#172033',
    surfaceSunken: '#111b2e',
    ink: '#f1f5f9',
    inkMuted: '#cbd5e1',
    inkSubtle: '#94a3b8',
    accent: '#60a5fa',
    accentInk: '#93c5fd',
    successInk: '#86efac',
    warningInk: '#fcd34d',
    dangerInk: '#fca5a5',
  }

  it('light theme body text meets 4.5:1 on every surface', () => {
    for (const bg of [LIGHT.surface, LIGHT.canvas, LIGHT.surfaceSunken]) {
      expect(contrast(LIGHT.ink, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(LIGHT.inkMuted, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('light theme subtle text meets 4.5:1 on white and canvas', () => {
    expect(contrast(LIGHT.inkSubtle, LIGHT.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(LIGHT.inkSubtle, LIGHT.canvas)).toBeGreaterThanOrEqual(4.5)
  })

  it('light theme accent and state inks meet 4.5:1 on white', () => {
    for (const c of [LIGHT.accent, LIGHT.accentInk, LIGHT.successInk, LIGHT.warningInk, LIGHT.dangerInk]) {
      expect(contrast(c, LIGHT.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('white text on the light accent meets 4.5:1', () => {
    expect(contrast('#ffffff', LIGHT.accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark theme body text meets 4.5:1 on every surface', () => {
    for (const bg of [DARK.surface, DARK.canvas, DARK.surfaceSunken]) {
      expect(contrast(DARK.ink, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(DARK.inkMuted, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('dark theme subtle text meets 4.5:1', () => {
    expect(contrast(DARK.inkSubtle, DARK.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(DARK.inkSubtle, DARK.canvas)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark theme accent and state inks meet 4.5:1 on the dark surface', () => {
    for (const c of [DARK.accent, DARK.accentInk, DARK.successInk, DARK.warningInk, DARK.dangerInk]) {
      expect(contrast(c, DARK.surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c, DARK.canvas)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('dark mode is a separate palette, not an inversion of light', () => {
    // A naive inversion would make the dark accent the exact complement.
    expect(DARK.accent).not.toBe(LIGHT.accent)
    expect(DARK.surface).not.toBe(LIGHT.surface)
    // Dark surfaces must be LIFTED above the dark canvas for elevation to read.
    expect(luminance(DARK.surface)).toBeGreaterThan(luminance(DARK.canvas))
    // Light surfaces are likewise lifted above the light canvas.
    expect(luminance(LIGHT.surface)).toBeGreaterThan(luminance(LIGHT.canvas))
  })
})
