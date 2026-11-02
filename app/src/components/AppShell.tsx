/**
 * Application shell: sidebar + top bar on desktop, bottom tab bar on mobile.
 *
 * Navigation is hash-based so the whole app works as a static file bundle on
 * GitHub Pages or Vercel with no server rewrite rules and no router dependency.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Brain,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Moon,
  PiggyBank,
  Receipt,
  RefreshCw,
  Repeat,
  Settings as SettingsIcon,
  Sun,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Badge, Button, cx } from './ui'
import type { MLStatus } from '../store/useMLWorker'
import type { Settings } from '../lib/types'

export type RouteId =
  | 'dashboard'
  | 'transactions'
  | 'insights'
  | 'forecast'
  | 'anomalies'
  | 'subscriptions'
  | 'budgets'
  | 'reports'
  | 'settings'

export interface NavItem {
  id: RouteId
  label: string
  shortLabel: string
  icon: LucideIcon
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard, description: 'Financial overview' },
  { id: 'transactions', label: 'Transactions', shortLabel: 'Txns', icon: Receipt, description: 'Manage and import' },
  { id: 'insights', label: 'AI Insights', shortLabel: 'Insights', icon: Lightbulb, description: 'Computed findings' },
  { id: 'forecast', label: 'Expense Forecast', shortLabel: 'Forecast', icon: TrendingUp, description: 'Predict next month' },
  { id: 'anomalies', label: 'Anomaly Detection', shortLabel: 'Alerts', icon: AlertTriangle, description: 'Unusual transactions' },
  { id: 'subscriptions', label: 'Subscriptions', shortLabel: 'Subs', icon: Repeat, description: 'Recurring payments' },
  { id: 'budgets', label: 'Budgets & Savings', shortLabel: 'Budgets', icon: PiggyBank, description: 'Limits and goals' },
  { id: 'reports', label: 'Reports', shortLabel: 'Reports', icon: BarChart3, description: 'Export and analyse' },
  { id: 'settings', label: 'Settings', shortLabel: 'More', icon: SettingsIcon, description: 'Data and preferences' },
]

/** Bottom bar shows the 5 most-used destinations; the rest live under "More". */
const MOBILE_PRIMARY: RouteId[] = ['dashboard', 'transactions', 'insights', 'forecast', 'settings']

export function useHashRoute(): [RouteId, (r: RouteId) => void] {
  const read = (): RouteId => {
    const raw = window.location.hash.replace(/^#\/?/, '') as RouteId
    return NAV_ITEMS.some((n) => n.id === raw) ? raw : 'dashboard'
  }
  const [route, setRoute] = useState<RouteId>(read)

  useEffect(() => {
    const onHash = () => {
      setRoute(read())
      // A route change should start at the top, like a real page navigation.
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (r: RouteId) => {
    window.location.hash = `/${r}`
  }
  return [route, navigate]
}

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex size-8 items-center justify-center rounded-lg"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        aria-hidden
      >
        {/* Mark: an upward trend inside a rounded square. */}
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M3 14.5L7.5 9.5L11 12.5L17 5.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12.5 5.5H17V10" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-[-0.015em]" style={{ color: 'var(--ink)' }}>
          FinSense AI
        </span>
        <span className="block text-[10.5px] font-medium" style={{ color: 'var(--ink-subtle)' }}>
          Local ML finance
        </span>
      </span>
    </span>
  )
}

function MLIndicator({ status }: { status: MLStatus }) {
  if (status.error) {
    return (
      <Badge tone="danger" icon={AlertTriangle}>
        ML error
      </Badge>
    )
  }
  if (status.busy) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <RefreshCw size={12} className="animate-spin-slow" style={{ color: 'var(--accent)' }} aria-hidden />
        <span className="hidden text-[11px] font-medium sm:inline" style={{ color: 'var(--ink-muted)' }}>
          {status.message}
        </span>
      </span>
    )
  }
  if (status.booted) {
    return (
      <Badge tone="success" icon={Brain}>
        Python ready
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" icon={Brain}>
      ML idle
    </Badge>
  )
}

export function AppShell({
  route,
  navigate,
  theme,
  onToggleTheme,
  mlStatus,
  alertCount,
  children,
}: {
  route: RouteId
  navigate: (r: RouteId) => void
  theme: Settings['theme']
  onToggleTheme: () => void
  mlStatus: MLStatus
  alertCount: number
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const active = NAV_ITEMS.find((n) => n.id === route) ?? NAV_ITEMS[0]

  const navButton = (item: NavItem, compact = false) => {
    const isActive = item.id === route
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          // Closing the drawer belongs to the click that caused it, not to an
          // effect watching the route.
          setDrawerOpen(false)
          navigate(item.id)
        }}
        aria-current={isActive ? 'page' : undefined}
        className={cx(
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors',
          compact && 'py-2',
        )}
        style={{
          background: isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--accent-ink)' : 'var(--ink-muted)',
        }}
      >
        <item.icon size={17} strokeWidth={isActive ? 2.2 : 1.9} aria-hidden />
        <span className="flex-1 truncate">{item.label}</span>
        {item.id === 'anomalies' && alertCount > 0 ? (
          <span
            className="tnum rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            style={{ background: 'var(--warning)', color: '#ffffff' }}
          >
            {alertCount > 99 ? '99+' : alertCount}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--canvas)' }}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:px-4 focus:py-2"
        style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
      >
        Skip to main content
      </a>

      {/* ---- desktop sidebar ---- */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="px-4 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
          {NAV_ITEMS.map((i) => navButton(i))}
        </nav>
        <div className="border-t px-4 py-3.5" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-subtle)' }}>
            All data stays in this browser. No bank connection, no cloud, no tracking.
          </p>
        </div>
      </aside>

      {/* ---- mobile drawer ---- */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0" style={{ background: 'rgb(15 23 42 / 0.55)' }} onClick={() => setDrawerOpen(false)} aria-hidden />
          <div
            className="animate-enter absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            role="dialog"
            aria-label="Navigation menu"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <Logo />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-2"
                style={{ color: 'var(--ink-subtle)' }}
              >
                <X size={18} aria-hidden />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-6" aria-label="Main navigation">
              {NAV_ITEMS.map((i) => navButton(i))}
            </nav>
          </div>
        </div>
      ) : null}

      {/* ---- top bar ---- */}
      <header
        className="sticky top-0 z-20 border-b lg:pl-60"
        style={{ background: 'color-mix(in srgb, var(--surface) 88%, transparent)', borderColor: 'var(--line)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="-ml-1 rounded-lg p-2 lg:hidden"
            style={{ color: 'var(--ink-muted)' }}
          >
            <Menu size={19} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--ink)' }}>
              {active.label}
            </h1>
            <p className="hidden truncate text-[11.5px] sm:block" style={{ color: 'var(--ink-subtle)' }}>
              {active.description}
            </p>
          </div>
          <MLIndicator status={mlStatus} />
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="!px-2"
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </Button>
        </div>
      </header>

      {/* ---- main ---- */}
      <main id="main-content" className="px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pl-66 lg:pr-6">
        <div className="mx-auto max-w-[1240px]">{children}</div>
      </main>

      {/* ---- mobile bottom nav ---- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Primary navigation"
      >
        <div className="grid grid-cols-5">
          {MOBILE_PRIMARY.map((id) => {
            const item = NAV_ITEMS.find((n) => n.id === id)!
            const isActive = item.id === route
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(id)}
                aria-current={isActive ? 'page' : undefined}
                className="relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[10.5px] font-medium transition-colors"
                style={{ color: isActive ? 'var(--accent)' : 'var(--ink-subtle)' }}
              >
                <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.9} aria-hidden />
                <span className="truncate">{item.shortLabel}</span>
                {isActive ? (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
                ) : null}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
