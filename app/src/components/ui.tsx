/**
 * Shared UI primitives.
 *
 * Deliberately hand-built on Tailwind + CSS variables (no paid UI kit, no
 * component library). Everything here is keyboard accessible and theme-aware
 * through the same tokens, so light and dark stay consistent without per-page
 * overrides.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Check, Info, Loader2, X, type LucideIcon } from 'lucide-react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Tag
      // min-w-0 lets a card shrink inside a grid track, and overflow-hidden
      // stops a chart's SVG from forcing the card wider than the viewport.
      className={cx('min-w-0 overflow-hidden rounded-[var(--radius-card)] border', className)}
      style={{ background: 'var(--surface)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-card)' }}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--line)' }}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Icon size={16} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
  loading?: boolean
  full?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  full,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizes = {
    // min-h-11 keeps every control at a 44px touch target on mobile.
    sm: 'h-9 px-3 text-[13px] gap-1.5',
    md: 'h-11 px-4 text-sm gap-2 sm:h-10',
    lg: 'h-12 px-5 text-[15px] gap-2',
  }[size]

  const style: Record<ButtonVariant, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-contrast)', borderColor: 'transparent' },
    secondary: { background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--line-strong)' },
    ghost: { background: 'transparent', color: 'var(--ink-muted)', borderColor: 'transparent' },
    danger: { background: 'var(--danger)', color: '#ffffff', borderColor: 'transparent' },
    success: { background: 'var(--success)', color: '#ffffff', borderColor: 'transparent' },
  }

  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg border font-medium transition-[background,border-color,opacity,transform] duration-150',
        'hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50',
        sizes,
        full && 'w-full',
        className,
      )}
      style={style[variant]}
    >
      {loading ? <Loader2 size={15} className="animate-spin-slow" aria-hidden /> : Icon ? <Icon size={15} aria-hidden /> : null}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const fieldStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderColor: 'var(--line-strong)',
  color: 'var(--ink)',
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-medium" style={{ color: 'var(--ink-muted)' }}>
        {label}
        {required ? (
          <span style={{ color: 'var(--danger)' }} aria-hidden>
            *
          </span>
        ) : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px]" style={{ color: 'var(--danger-ink)' }} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[12px]" style={{ color: 'var(--ink-subtle)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-11 w-full rounded-lg border px-3 text-sm transition-colors placeholder:opacity-60 sm:h-10',
        className,
      )}
      style={fieldStyle}
    />
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx('h-11 w-full rounded-lg border px-3 text-sm transition-colors sm:h-10', className)}
      style={fieldStyle}
    >
      {children}
    </select>
  )
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx('w-full rounded-lg border px-3 py-2 text-sm transition-colors', className)}
      style={fieldStyle}
    />
  )
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({
  tone = 'neutral',
  children,
  icon: Icon,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  icon?: LucideIcon
  className?: string
}) {
  const tones: Record<BadgeTone, React.CSSProperties> = {
    neutral: { background: 'var(--surface-sunken)', color: 'var(--ink-muted)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    success: { background: 'var(--success-soft)', color: 'var(--success-ink)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning-ink)' },
    danger: { background: 'var(--danger-soft)', color: 'var(--danger-ink)' },
  }
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold', className)}
      style={tones[tone]}
    >
      {Icon ? <Icon size={11} aria-hidden /> : null}
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function ProgressBar({
  value,
  tone = 'accent',
  label,
  /** Secondary marker, e.g. the expected pace through the month. */
  marker,
}: {
  value: number
  tone?: BadgeTone
  label?: string
  marker?: number
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const colors: Record<BadgeTone, string> = {
    neutral: 'var(--ink-subtle)',
    accent: 'var(--accent)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
  }
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--surface-sunken)' }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: colors[tone] }} />
      {marker !== undefined && marker > 0 && marker < 1 ? (
        <span
          className="absolute inset-y-0 w-px"
          style={{ left: `${marker * 100}%`, background: 'var(--ink-subtle)', opacity: 0.6 }}
          aria-hidden
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty / error / skeleton states
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span
        className="mb-4 flex size-12 items-center justify-center rounded-xl"
        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-subtle)' }}
      >
        <Icon size={22} strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span
        className="mb-4 flex size-12 items-center justify-center rounded-xl"
        style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
      >
        <AlertTriangle size={22} strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
        {title}
      </h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {message}
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="mt-5">
          Try again
        </Button>
      ) : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-32" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Modal + confirmation dialog
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // onClose is usually an inline arrow, so its identity changes on every parent
  // render. Holding it in a ref keeps the focus effect below keyed ONLY on
  // `open`. Without this the effect re-ran on each keystroke and its cleanup
  // restored focus to the opening button, so typing into a dialog input (for
  // example the "DELETE" confirmation) silently lost every character after the
  // first.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
      if (e.key === 'Tab' && ref.current) {
        // Focus trap: keep tabbing inside the dialog.
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const previous = document.activeElement as HTMLElement | null
    const t = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    }, 30)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      clearTimeout(t)
      // Return focus to whatever opened the dialog, but never steal it from an
      // element inside a dialog that is still mounted.
      if (!ref.current?.contains(document.activeElement)) previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-5xl' }[size]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0" style={{ background: 'rgb(15 23 42 / 0.55)' }} onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'animate-enter relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl',
          widths,
        )}
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-pop)' }}
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'var(--line)' }}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-m-1 shrink-0 rounded-lg p-1.5 transition-colors hover:opacity-70"
            style={{ color: 'var(--ink-subtle)' }}
          >
            <X size={18} aria-hidden />
          </button>
        </header>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <footer
            className="flex flex-wrap justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  /** When set, the user must type this exact text to enable confirmation. */
  requireTyped?: string
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null)
  const [typed, setTyped] = useState('')

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setTyped('')
      setState({ opts, resolve })
    })

  const close = (result: boolean) => {
    state?.resolve(result)
    setState(null)
    setTyped('')
  }

  const needsTyped = state?.opts.requireTyped
  const canConfirm = !needsTyped || typed.trim() === needsTyped

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.opts.title ?? ''}
        description={state?.opts.message}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              variant={state?.opts.tone === 'danger' ? 'danger' : 'primary'}
              onClick={() => close(true)}
              disabled={!canConfirm}
            >
              {state?.opts.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        {needsTyped ? (
          <Field label={`Type "${needsTyped}" to confirm`} required>
            <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={needsTyped} autoComplete="off" />
          </Field>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: { id: number; tone: 'success' | 'error' | 'info' | 'warning'; message: string }[]
  onDismiss: (id: number) => void
}) {
  const icons = { success: Check, error: AlertTriangle, warning: AlertTriangle, info: Info }
  const tones: Record<string, React.CSSProperties> = {
    success: { background: 'var(--success-soft)', color: 'var(--success-ink)', borderColor: 'var(--success)' },
    error: { background: 'var(--danger-soft)', color: 'var(--danger-ink)', borderColor: 'var(--danger)' },
    warning: { background: 'var(--warning-soft)', color: 'var(--warning-ink)', borderColor: 'var(--warning)' },
    info: { background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'var(--accent)' },
  }
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone]
        return (
          <div
            key={t.id}
            className="animate-toast pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border-l-4 px-4 py-3 text-[13px] font-medium"
            style={{ ...tones[t.tone], boxShadow: 'var(--shadow-pop)' }}
          >
            <Icon size={16} className="mt-px shrink-0" aria-hidden />
            <span className="flex-1 leading-relaxed">{t.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      {/* maxWidth is clamped to the viewport so a centred tooltip on a narrow
          card cannot push the page sideways on mobile. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{
          maxWidth: 'min(18rem, calc(100vw - 2rem))',
          background: 'var(--ink)',
          color: 'var(--surface)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        {text}
      </span>
    </span>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--ink-subtle)' }}>
        {children}
      </h2>
      {action}
    </div>
  )
}
