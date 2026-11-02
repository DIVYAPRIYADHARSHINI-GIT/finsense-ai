/** Dashboard metric tile. Values are always real computed figures. */

import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card, Skeleton, Tooltip } from './ui'

export function MetricCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = 'neutral',
  delta,
  deltaLabel,
  loading,
  /** Shown as a hover/focus tooltip explaining how the figure is derived. */
  help,
  /** Lower values are better (e.g. expenses), so invert the delta colouring. */
  invertDelta,
}: {
  label: string
  value: string
  sublabel?: string
  icon?: LucideIcon
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  delta?: number | null
  deltaLabel?: string
  loading?: boolean
  help?: string
  invertDelta?: boolean
}) {
  const toneColor = {
    neutral: 'var(--ink)',
    accent: 'var(--accent)',
    success: 'var(--success-ink)',
    warning: 'var(--warning-ink)',
    danger: 'var(--danger-ink)',
  }[tone]

  const good = delta === null || delta === undefined ? null : invertDelta ? delta < 0 : delta > 0
  const DeltaIcon = delta === null || delta === undefined || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <Card className="p-4 sm:p-[18px]" as="div">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium leading-tight" style={{ color: 'var(--ink-muted)' }}>
          {help ? (
            <Tooltip text={help}>
              <span className="cursor-help border-b border-dotted" style={{ borderColor: 'var(--line-strong)' }} tabIndex={0}>
                {label}
              </span>
            </Tooltip>
          ) : (
            label
          )}
        </p>
        {Icon ? (
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-subtle)' }}
          >
            <Icon size={14} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-28" />
      ) : (
        <p className="tnum mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] sm:text-[25px]" style={{ color: toneColor }}>
          {value}
        </p>
      )}

      <div className="mt-2 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-1">
        {delta !== null && delta !== undefined && Number.isFinite(delta) ? (
          <span
            className="tnum inline-flex items-center gap-0.5 text-[11.5px] font-semibold"
            style={{ color: good === null ? 'var(--ink-subtle)' : good ? 'var(--success-ink)' : 'var(--danger-ink)' }}
          >
            <DeltaIcon size={12} aria-hidden />
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : null}
        {sublabel || deltaLabel ? (
          <span className="text-[11.5px]" style={{ color: 'var(--ink-subtle)' }}>
            {deltaLabel ?? sublabel}
          </span>
        ) : null}
      </div>
    </Card>
  )
}
