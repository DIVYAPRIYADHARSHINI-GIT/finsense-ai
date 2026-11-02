/** CSV engine + import pipeline. Each test uses its own independent fixture. */

import { describe, expect, it } from 'vitest'
import { autoMapColumns, looksLikeHeader, parseCSV, sniffDelimiter, stripBOM, toCSV } from '../lib/csv'
import { dedupeKey, inferDayFirst, mapRowsToTransactions, parseAmountCell, parseDateCell } from '../lib/import'

describe('CSV parsing', () => {
  it('strips a UTF-8 BOM', () => {
    expect(stripBOM('\uFEFFDate,Amount')).toBe('Date,Amount')
    expect(stripBOM('Date,Amount')).toBe('Date,Amount')
  })

  it('sniffs comma, semicolon, tab and pipe delimiters', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(sniffDelimiter('a|b|c\n1|2|3')).toBe('|')
  })

  it('does not mistake a comma inside a quoted field for a delimiter', () => {
    // Every row has 3 semicolon-separated fields; the comma lives inside quotes.
    const csv = 'a;b;c\n"x,y";2;3\n"p,q";5;6'
    expect(sniffDelimiter(csv)).toBe(';')
    const rows = parseCSV(csv)
    expect(rows[1]).toEqual(['x,y', '2', '3'])
  })

  it('handles quoted fields containing delimiters, quotes and newlines', () => {
    const csv = 'a,b\n"has, comma","has ""quotes"""\n"line\nbreak",plain'
    const rows = parseCSV(csv)
    expect(rows[1]).toEqual(['has, comma', 'has "quotes"'])
    expect(rows[2]).toEqual(['line\nbreak', 'plain'])
  })

  it('preserves Tamil, Hindi and emoji text', () => {
    const csv = 'merchant,amount\nஅண்ணா மெஸ்,180\nचाय की दुकान,45\n"cafe ☕",99'
    const rows = parseCSV(csv)
    expect(rows[1][0]).toBe('அண்ணா மெஸ்')
    expect(rows[2][0]).toBe('चाय की दुकान')
    expect(rows[3][0]).toBe('cafe ☕')
  })

  it('ignores blank trailing lines but keeps empty cells', () => {
    const rows = parseCSV('a,b,c\n1,,3\n\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['1', '', '3'])
  })

  it('round-trips through toCSV with escaping', () => {
    const rows = [
      ['h1', 'h2'],
      ['has, comma', 'has "quote"'],
      ['line\nbreak', 'அண்ணா'],
    ]
    const parsed = parseCSV(toCSV(rows))
    expect(parsed).toEqual(rows)
  })

  it('detects a header row versus a data row', () => {
    expect(looksLikeHeader(['Date', 'Description', 'Amount'])).toBe(true)
    expect(looksLikeHeader(['2025-01-01', 'Shop', '120.50'])).toBe(false)
  })

  it('auto-maps common Indian bank header names', () => {
    const map = autoMapColumns(['Txn Date', 'Narration', 'Withdrawal Amt', 'Deposit Amt', 'Mode'])
    expect(map[0]).toBe('date')
    expect(map[1]).toBe('description')
    expect(map[2]).toBe('debit')
    expect(map[3]).toBe('credit')
    expect(map[4]).toBe('paymentMethod')
  })

  it('does not let "Debit Amount" steal the plain "Amount" mapping', () => {
    const map = autoMapColumns(['Date', 'Amount', 'Debit'])
    expect(map[1]).toBe('amount')
    expect(map[2]).toBe('debit')
  })
})

describe('date cell parsing', () => {
  it('parses ISO, slash, dash, dot and month-name formats', () => {
    expect(parseDateCell('2025-03-31')).toBe('2025-03-31')
    expect(parseDateCell('31/03/2025')).toBe('2025-03-31')
    expect(parseDateCell('31-03-2025')).toBe('2025-03-31')
    expect(parseDateCell('31.03.2025')).toBe('2025-03-31')
    expect(parseDateCell('31 Mar 2025')).toBe('2025-03-31')
    expect(parseDateCell('Mar 31, 2025')).toBe('2025-03-31')
  })

  it('uses a day > 12 as proof of day-first regardless of the hint', () => {
    expect(parseDateCell('25/12/2025', false)).toBe('2025-12-25')
    expect(parseDateCell('13/01/2025', false)).toBe('2025-01-13')
  })

  it('resolves the ambiguous case with the dayFirst flag', () => {
    expect(parseDateCell('03/04/2025', true)).toBe('2025-04-03')
    expect(parseDateCell('03/04/2025', false)).toBe('2025-03-04')
  })

  it('infers day-first from a column containing a day above 12', () => {
    expect(inferDayFirst(['01/02/2025', '25/02/2025'])).toBe(true)
    expect(inferDayFirst(['01/13/2025', '02/28/2025'])).toBe(false)
    // No evidence either way: Indian statements default to dd/MM.
    expect(inferDayFirst(['01/02/2025', '03/04/2025'])).toBe(true)
  })

  it('rejects impossible and empty dates', () => {
    expect(parseDateCell('2025-02-30')).toBeNull()
    expect(parseDateCell('')).toBeNull()
    expect(parseDateCell('not-a-date')).toBeNull()
  })

  it('expands two-digit years sensibly', () => {
    expect(parseDateCell('31/03/25')).toBe('2025-03-31')
    expect(parseDateCell('31/03/99')).toBe('1999-03-31')
  })
})

describe('amount cell parsing', () => {
  it('parses plain, grouped and currency-prefixed amounts', () => {
    expect(parseAmountCell('1234.56')).toBeCloseTo(1234.56)
    expect(parseAmountCell('1,234.56')).toBeCloseTo(1234.56)
    expect(parseAmountCell('₹1,234.56')).toBeCloseTo(1234.56)
    expect(parseAmountCell('12,34,567.89')).toBeCloseTo(1234567.89)
  })

  it('treats accounting parentheses and Dr markers as negative', () => {
    expect(parseAmountCell('(500.00)')).toBeCloseTo(-500)
    expect(parseAmountCell('-500.00')).toBeCloseTo(-500)
    expect(parseAmountCell('500.00 Dr')).toBeCloseTo(-500)
  })

  it('handles the European decimal comma', () => {
    expect(parseAmountCell('1.234,56')).toBeCloseTo(1234.56)
  })

  it('returns null for empty or non-numeric cells', () => {
    expect(parseAmountCell('')).toBeNull()
    expect(parseAmountCell('   ')).toBeNull()
    expect(parseAmountCell('abc')).toBeNull()
  })
})

describe('row mapping', () => {
  const mapping = { 0: 'date', 1: 'description', 2: 'merchant', 3: 'debit', 4: 'credit' } as const

  it('splits debit and credit columns into expense and income', () => {
    const rows = [
      ['Date', 'Narration', 'Payee', 'Withdrawal', 'Deposit'],
      ['01/04/2025', 'SHOP', 'Shop', '250.00', ''],
      ['02/04/2025', 'SALARY', 'Employer', '', '50000.00'],
    ]
    const res = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].txn.type).toBe('expense')
    expect(res.rows[0].txn.amountPaise).toBe(25000)
    expect(res.rows[1].txn.type).toBe('income')
    expect(res.rows[1].txn.amountPaise).toBe(5000000)
  })

  it('reports a row-level error instead of discarding a bad date', () => {
    const rows = [
      ['Date', 'Narration', 'Payee', 'Withdrawal', 'Deposit'],
      ['garbage', 'SHOP', 'Shop', '250.00', ''],
    ]
    const res = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true })
    expect(res.rows).toHaveLength(0)
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].rowNumber).toBe(2)
    expect(res.failed[0].errors[0]).toMatch(/Unrecognised date/)
  })

  it('reports missing amounts rather than importing a zero', () => {
    const rows = [
      ['Date', 'Narration', 'Payee', 'Withdrawal', 'Deposit'],
      ['01/04/2025', 'NO AMOUNT', 'Vendor', '', ''],
    ]
    const res = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true })
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].errors.join(' ')).toMatch(/Missing amount|Unrecognised amount/)
  })

  it('accounts for every input row across rows, skipped and failed', () => {
    const rows = [
      ['Date', 'Narration', 'Payee', 'Withdrawal', 'Deposit'],
      ['01/04/2025', 'A', 'A', '10.00', ''],
      ['bad', 'B', 'B', '20.00', ''],
      ['', '', '', '', ''],
      ['01/04/2025', 'A', 'A', '10.00', ''],
    ]
    const res = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true })
    expect(res.total).toBe(4)
    expect(res.rows.length + res.skipped.length + res.failed.length).toBe(res.total)
  })

  it('detects duplicates inside the file and against stored data', () => {
    const rows = [
      ['Date', 'Narration', 'Payee', 'Withdrawal', 'Deposit'],
      ['01/04/2025', 'SHOP', 'Shop', '250.00', ''],
      ['01/04/2025', 'SHOP', 'Shop', '250.00', ''],
    ]
    const inFile = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true })
    expect(inFile.rows).toHaveLength(1)
    expect(inFile.skipped[0].reason).toMatch(/within this file/)

    const existing = new Set([dedupeKey(inFile.rows[0].txn)])
    const again = mapRowsToTransactions(rows, { mapping: { ...mapping }, hasHeader: true, existingKeys: existing })
    expect(again.rows).toHaveLength(0)
    expect(again.skipped[0].reason).toMatch(/already stored/)
  })

  it('infers a merchant from a UPI narration when the column is absent', () => {
    const rows = [
      ['Date', 'Narration', 'Withdrawal'],
      ['01/04/2025', 'UPI/DR/402938471/FRESHCART SUPERMARKET', '250.00'],
    ]
    const res = mapRowsToTransactions(rows, {
      mapping: { 0: 'date', 1: 'description', 2: 'debit' },
      hasHeader: true,
    })
    expect(res.rows[0].txn.merchant).toMatch(/FRESHCART/i)
    expect(res.rows[0].warnings.join(' ')).toMatch(/inferred/)
  })

  it('marks uncategorised rows for ML prediction rather than guessing', () => {
    const rows = [
      ['Date', 'Narration', 'Withdrawal'],
      ['01/04/2025', 'SOME SHOP', '250.00'],
    ]
    const res = mapRowsToTransactions(rows, { mapping: { 0: 'date', 1: 'description', 2: 'debit' }, hasHeader: true })
    expect(res.rows[0].txn.categorySource).toBe('ml')
    expect(res.rows[0].warnings.join(' ')).toMatch(/predicted/)
  })

  it('preserves Unicode merchants through the whole pipeline', () => {
    const csv = '\uFEFFDate;Narration;Payee;Withdrawal\r\n17/06/2025;UPI/DR/1/அண்ணா மெஸ்;அண்ணா மெஸ்;180.00\r\n'
    const parsed = parseCSV(csv, ';')
    const res = mapRowsToTransactions(parsed, {
      mapping: { 0: 'date', 1: 'description', 2: 'merchant', 3: 'debit' },
      hasHeader: true,
    })
    expect(res.rows[0].txn.merchant).toBe('அண்ணா மெஸ்')
    expect(res.rows[0].txn.date).toBe('2025-06-17')
  })
})
