/**
 * Month / year / custom-range filter shared by the dashboard and reports.
 * The selection is derived state only - it never mutates stored transactions.
 */

import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import { Select, TextInput, cx } from './ui'
import { monthKey, monthLabel } from '../lib/dates'
import type { Transaction } from '../lib/types'

export type FilterMode = 'all' | 'month' | 'year' | 'custom'

export interface RangeFilter {
  mode: FilterMode
  month: string
  year: string
  from: string
  to: string
}

export function defaultRangeFilter(today: string): RangeFilter {
  return { mode: 'month', month: monthKey(today), year: today.slice(0, 4), from: '', to: '' }
}

/** Resolve a filter into concrete inclusive ISO bounds. */
export function resolveRange(filter: RangeFilter): { from?: string; to?: string; label: string } {
  switch (filter.mode) {
    case 'month': {
      const [y, m] = filter.month.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      return { from: `${filter.month}-01`, to: `${filter.month}-${`${last}`.padStart(2, '0')}`, label: monthLabel(filter.month) }
    }
    case 'year':
      return { from: `${filter.year}-01-01`, to: `${filter.year}-12-31`, label: filter.year }
    case 'custom':
      return {
        from: filter.from || undefined,
        to: filter.to || undefined,
        label: filter.from || filter.to ? `${filter.from || 'start'} to ${filter.to || 'today'}` : 'Custom range',
      }
    default:
      return { label: 'All time' }
  }
}

export function DateFilterBar({
  filter,
  onChange,
  transactions,
  className,
}: {
  filter: RangeFilter
  onChange: (f: RangeFilter) => void
  transactions: Transaction[]
  className?: string
}) {
  // Only offer months and years that actually contain data.
  const { months, years } = useMemo(() => {
    const ms = new Set<string>()
    const ys = new Set<string>()
    for (const t of transactions) {
      ms.add(monthKey(t.date))
      ys.add(t.date.slice(0, 4))
    }
    if (!ms.has(filter.month)) ms.add(filter.month)
    if (!ys.has(filter.year)) ys.add(filter.year)
    return {
      months: [...ms].sort().reverse(),
      years: [...ys].sort().reverse(),
    }
  }, [transactions, filter.month, filter.year])

  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
        <CalendarRange size={14} aria-hidden />
        <span className="hidden sm:inline">Period</span>
      </span>
      <Select
        value={filter.mode}
        onChange={(e) => onChange({ ...filter, mode: e.target.value as FilterMode })}
        className="!h-9 !w-auto !text-[13px]"
        aria-label="Filter period type"
      >
        <option value="month">Month</option>
        <option value="year">Year</option>
        <option value="custom">Custom range</option>
        <option value="all">All time</option>
      </Select>

      {filter.mode === 'month' ? (
        <Select
          value={filter.month}
          onChange={(e) => onChange({ ...filter, month: e.target.value })}
          className="!h-9 !w-auto !text-[13px]"
          aria-label="Select month"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
      ) : null}

      {filter.mode === 'year' ? (
        <Select
          value={filter.year}
          onChange={(e) => onChange({ ...filter, year: e.target.value })}
          className="!h-9 !w-auto !text-[13px]"
          aria-label="Select year"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      ) : null}

      {filter.mode === 'custom' ? (
        <>
          <TextInput
            type="date"
            value={filter.from}
            max={filter.to || undefined}
            onChange={(e) => onChange({ ...filter, from: e.target.value })}
            className="!h-9 !w-auto !text-[13px]"
            aria-label="From date"
          />
          <span className="text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
            to
          </span>
          <TextInput
            type="date"
            value={filter.to}
            min={filter.from || undefined}
            onChange={(e) => onChange({ ...filter, to: e.target.value })}
            className="!h-9 !w-auto !text-[13px]"
            aria-label="To date"
          />
        </>
      ) : null}
    </div>
  )
}
