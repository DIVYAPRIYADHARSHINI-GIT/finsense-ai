/**
 * Recharts wrappers bound to the FinSense theme tokens.
 *
 * All chart input comes from the live transaction store - there is no mock
 * series anywhere. Each chart renders an explicit empty state rather than an
 * axis with no data, so a chart is never "fake".
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ReactNode } from 'react'
import { formatMoney } from '../lib/money'
import type { Settings } from '../lib/types'

/** Category colour ramp: distinguishable in both themes, no gradients. */
export const CATEGORY_COLORS = [
  '#2563eb', '#0d9488', '#d97706', '#7c3aed', '#dc2626',
  '#0891b2', '#65a30d', '#db2777', '#ea580c', '#4f46e5',
  '#059669', '#9333ea', '#b45309', '#475569',
]

export function colorForIndex(i: number): string {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]
}

function compact(paise: number, currency: Settings['currency']): string {
  return formatMoney(paise, currency, { compact: true })
}

export function ChartFrame({
  children,
  height = 260,
  empty,
  emptyMessage,
}: {
  children: ReactNode
  height?: number
  empty?: boolean
  emptyMessage?: string
}) {
  if (empty) {
    return (
      <div className="flex items-center justify-center px-6 text-center" style={{ height }}>
        <p className="max-w-xs text-[13px]" style={{ color: 'var(--ink-subtle)' }}>
          {emptyMessage ?? 'Not enough data to draw this chart yet.'}
        </p>
      </div>
    )
  }
  return (
    // minWidth:0 is required: without it ResponsiveContainer measures its own
    // last rendered width and can ratchet the container wider each resize.
    <div style={{ height, width: '100%', minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  )
}

function TooltipBox({
  active,
  payload,
  label,
  currency,
  /** Values arrive as rupees rather than paise for ML-derived charts. */
  major,
}: {
  active?: boolean
  payload?: { name?: string; value?: number; color?: string; dataKey?: string }[]
  label?: string
  currency: Settings['currency']
  major?: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-lg border px-3 py-2 text-[12px]"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-pop)' }}
    >
      {label ? (
        <p className="mb-1 font-semibold" style={{ color: 'var(--ink)' }}>
          {label}
        </p>
      ) : null}
      {payload.map((p, i) => (
        <p key={i} className="tnum flex items-center gap-2" style={{ color: 'var(--ink-muted)' }}>
          <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="flex-1">{p.name}</span>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>
            {formatMoney(major ? (p.value ?? 0) * 100 : (p.value ?? 0), currency)}
          </span>
        </p>
      ))}
    </div>
  )
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11 },
} as const

// ---------------------------------------------------------------------------

export function IncomeExpenseChart({
  data,
  currency,
  height = 280,
}: {
  data: { label: string; incomePaise: number; expensePaise: number }[]
  currency: Settings['currency']
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={data.length === 0} emptyMessage="Add transactions to see income against expenses.">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v), currency)} width={58} />
        <Tooltip content={<TooltipBox currency={currency} />} cursor={{ fill: 'var(--surface-sunken)' }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: 'var(--ink-muted)', paddingTop: 8 }}
        />
        <Bar dataKey="incomePaise" name="Income" fill="var(--success)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expensePaise" name="Expenses" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartFrame>
  )
}

export function CategoryDonut({
  data,
  currency,
  height = 280,
}: {
  data: { category: string; paise: number }[]
  currency: Settings['currency']
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={data.length === 0} emptyMessage="No categorised expenses in this period.">
      <PieChart>
        <Pie
          data={data}
          dataKey="paise"
          nameKey="category"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={1.5}
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colorForIndex(i)} />
          ))}
        </Pie>
        <Tooltip content={<TooltipBox currency={currency} />} />
        <Legend
          iconType="circle"
          iconSize={8}
          layout="vertical"
          align="right"
          verticalAlign="middle"
          wrapperStyle={{ fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: '19px', maxWidth: '45%' }}
        />
      </PieChart>
    </ChartFrame>
  )
}

export function TrendAreaChart({
  data,
  dataKey,
  name,
  currency,
  color = 'var(--accent)',
  height = 240,
  xKey = 'label',
}: {
  data: Record<string, unknown>[]
  dataKey: string
  name: string
  currency: Settings['currency']
  color?: string
  height?: number
  xKey?: string
}) {
  const gradId = `grad-${dataKey}`
  return (
    <ChartFrame height={height} empty={data.length === 0}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v), currency)} width={58} />
        <Tooltip content={<TooltipBox currency={currency} />} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartFrame>
  )
}

export function CategoryBarChart({
  data,
  currency,
  height = 280,
}: {
  data: { category: string; paise: number }[]
  currency: Settings['currency']
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={data.length === 0}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={(v) => compact(Number(v), currency)} />
        <YAxis type="category" dataKey="category" {...axisProps} width={104} />
        <Tooltip content={<TooltipBox currency={currency} />} cursor={{ fill: 'var(--surface-sunken)' }} />
        <Bar dataKey="paise" name="Spent" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((_, i) => (
            <Cell key={i} fill={colorForIndex(i)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  )
}

/**
 * Actual vs predicted, used by both the dashboard and the forecast page.
 * Values are in MAJOR units here because they come straight from the Python
 * backtest, which works in rupees.
 */
export function ActualVsPredictedChart({
  data,
  currency,
  height = 280,
}: {
  data: { month: string; actual: number | null; predicted: number | null }[]
  currency: Settings['currency']
  height?: number
}) {
  return (
    <ChartFrame height={height} empty={data.length === 0} emptyMessage="Run the forecast model to compare predictions with actuals.">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v) * 100, currency)} width={58} />
        <Tooltip content={<TooltipBox currency={currency} major />} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--ink-muted)', paddingTop: 8 }} />
        <Bar dataKey="actual" name="Actual" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Line
          type="monotone"
          dataKey="predicted"
          name="Predicted"
          stroke="var(--warning)"
          strokeWidth={2.2}
          strokeDasharray="5 4"
          dot={{ r: 3, strokeWidth: 0, fill: 'var(--warning)' }}
          connectNulls
        />
      </ComposedChart>
    </ChartFrame>
  )
}

/** 30-day forecast with its empirical uncertainty band. */
export function ForecastBandChart({
  data,
  currency,
  height = 260,
}: {
  data: { date: string; predicted: number; lower: number; upper: number }[]
  currency: Settings['currency']
  height?: number
}) {
  const shaped = data.map((d) => ({
    ...d,
    label: d.date.slice(5),
    band: [d.lower, d.upper] as [number, number],
  }))
  return (
    <ChartFrame height={height} empty={data.length === 0}>
      <ComposedChart data={shaped} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={4} />
        <YAxis {...axisProps} tickFormatter={(v) => compact(Number(v) * 100, currency)} width={58} />
        <Tooltip content={<TooltipBox currency={currency} major />} />
        <Area
          type="monotone"
          dataKey="band"
          name="Uncertainty range"
          stroke="none"
          fill="var(--accent)"
          fillOpacity={0.13}
        />
        <Line
          type="monotone"
          dataKey="predicted"
          name="Predicted daily spend"
          stroke="var(--accent)"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ChartFrame>
  )
}
