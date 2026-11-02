/**
 * Deterministic fictional sample dataset.
 *
 * Every merchant, employer and amount here is invented. There is no real
 * banking information in this file and none is ever requested by the app.
 *
 * The generator is seeded (mulberry32) so the same dataset appears on every
 * machine, which is what makes the ML metrics in the README reproducible.
 *
 * The dataset is deliberately shaped to exercise all four ML/analytics modules:
 *  - classification: 14 categories, noisy UPI narrations, Tamil + Hindi merchants
 *  - forecasting: 12 full months with a festival bump and a rising trend
 *  - anomaly detection: a handful of planted high-value outliers
 *  - recurring detection: rent, EMI, 4 subscriptions, 2 utilities on real cycles
 */

import { addDays, addMonths, monthKey, parseISO, toISO, todayISO } from './dates'
import { toPaise } from './money'
import type { Category, PaymentMethod, Transaction, TxnType } from './types'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface MerchantSpec {
  merchant: string
  category: Category
  method: PaymentMethod
  /** Mean spend in rupees. */
  mean: number
  spread: number
  /** Expected transactions per month. */
  perMonth: number
  narration?: (merchant: string, ref: string) => string
}

/**
 * Narration variants.
 *
 * Real statements never repeat one fixed string per merchant: they carry outlet
 * names, cities, terminal tags and product lines. Without that variety the
 * classifier would be memorising ~45 constant strings and its reported accuracy
 * would be meaningless. Each narration therefore mixes in a seeded suffix,
 * which gives the TF-IDF model a genuine generalisation task.
 */
const OUTLETS = [
  'KORAMANGALA', 'INDIRANAGAR', 'WHITEFIELD', 'JAYANAGAR', 'HSR LAYOUT',
  'BTM LAYOUT', 'MARATHAHALLI', 'RAJAJINAGAR', 'YELAHANKA', 'BANASHANKARI',
]
const TERMINALS = ['TID', 'TRM', 'ECOM', 'APP', 'QR']

/** Deterministic variant suffix derived from the reference number. */
function variant(ref: string, pool: string[]): string {
  let h = 0
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0
  return pool[h % pool.length]
}

const upi = (m: string, ref: string) =>
  `UPI/DR/${ref}/${m.toUpperCase()}/${variant(ref, OUTLETS)}/${variant(`${ref}x`, TERMINALS)}`
const card = (m: string, ref: string) =>
  `POS ${ref} ${m.toUpperCase()} ${variant(ref, OUTLETS)} ${variant(`${ref}y`, TERMINALS)}`

const MERCHANTS: MerchantSpec[] = [
  // Food & Dining
  { merchant: 'Spice Route Cafe', category: 'Food & Dining', method: 'UPI', mean: 420, spread: 180, perMonth: 3, narration: upi },
  { merchant: 'QuickBite Delivery', category: 'Food & Dining', method: 'UPI', mean: 365, spread: 150, perMonth: 3.5, narration: upi },
  { merchant: '\u0B85\u0BA3\u0BCD\u0BA3\u0BBE \u0BAE\u0BC6\u0BB8\u0BCD', category: 'Food & Dining', method: 'Cash', mean: 180, spread: 70, perMonth: 3, narration: upi },
  { merchant: '\u091A\u093E\u092F \u0915\u0940 \u0926\u0941\u0915\u093E\u0928', category: 'Food & Dining', method: 'Cash', mean: 70, spread: 25, perMonth: 4, narration: upi },
  { merchant: 'Brew & Bean', category: 'Food & Dining', method: 'Credit Card', mean: 290, spread: 110, perMonth: 3, narration: card },
  // Groceries
  { merchant: 'FreshCart Supermarket', category: 'Groceries', method: 'UPI', mean: 1750, spread: 620, perMonth: 2.5, narration: upi },
  { merchant: 'Green Basket Organics', category: 'Groceries', method: 'UPI', mean: 940, spread: 340, perMonth: 2, narration: upi },
  { merchant: 'DailyNeeds Kirana', category: 'Groceries', method: 'Cash', mean: 520, spread: 210, perMonth: 3, narration: upi },
  // Transportation
  { merchant: 'MetroLink Transit', category: 'Transportation', method: 'UPI', mean: 60, spread: 20, perMonth: 8, narration: upi },
  { merchant: 'RideNow Cabs', category: 'Transportation', method: 'UPI', mean: 285, spread: 140, perMonth: 4, narration: upi },
  { merchant: 'PetroMax Fuel', category: 'Transportation', method: 'Debit Card', mean: 2200, spread: 450, perMonth: 1.5, narration: card },
  // Shopping
  { merchant: 'UrbanThread Apparel', category: 'Shopping', method: 'Credit Card', mean: 2650, spread: 1400, perMonth: 1.2, narration: card },
  { merchant: 'MegaMart Online', category: 'Shopping', method: 'Credit Card', mean: 1850, spread: 1200, perMonth: 1.4, narration: card },
  { merchant: 'GadgetHub Electronics', category: 'Shopping', method: 'Credit Card', mean: 4800, spread: 2600, perMonth: 0.4, narration: card },
  // Entertainment
  { merchant: 'Cineplex Grand', category: 'Entertainment', method: 'UPI', mean: 640, spread: 240, perMonth: 1.2, narration: upi },
  { merchant: 'PlayArena Sports', category: 'Entertainment', method: 'UPI', mean: 850, spread: 300, perMonth: 0.8, narration: upi },
  // Healthcare
  { merchant: 'WellCare Pharmacy', category: 'Healthcare', method: 'UPI', mean: 680, spread: 380, perMonth: 1.2, narration: upi },
  { merchant: 'City Clinic Labs', category: 'Healthcare', method: 'Debit Card', mean: 1450, spread: 700, perMonth: 0.4, narration: card },
  // Education
  { merchant: 'SkillForge Academy', category: 'Education', method: 'Credit Card', mean: 2999, spread: 500, perMonth: 0.35, narration: card },
  { merchant: 'PaperTrail Books', category: 'Education', method: 'UPI', mean: 740, spread: 320, perMonth: 0.6, narration: upi },
  // Travel
  { merchant: 'SkyFare Airways', category: 'Travel', method: 'Credit Card', mean: 7200, spread: 3100, perMonth: 0.3, narration: card },
  { merchant: 'StayEasy Hotels', category: 'Travel', method: 'Credit Card', mean: 4400, spread: 1800, perMonth: 0.25, narration: card },
  { merchant: 'RailConnect Booking', category: 'Travel', method: 'UPI', mean: 1250, spread: 600, perMonth: 0.4, narration: upi },
]

/** Fixed-day recurring commitments - what the recurring detector should find. */
interface RecurringSpec {
  merchant: string
  category: Category
  method: PaymentMethod
  amount: number
  /** Jitter in rupees, 0 for an exact standing instruction. */
  jitter: number
  dayOfMonth: number
  narration: string
  everyMonths?: number
}

const RECURRING: RecurringSpec[] = [
  { merchant: 'Greenleaf Properties', category: 'Rent', method: 'Auto Debit', amount: 24000, jitter: 0, dayOfMonth: 3, narration: 'NACH/RENT/GREENLEAF PROPERTIES' },
  { merchant: 'Northwind Finance', category: 'Other', method: 'Auto Debit', amount: 8450, jitter: 0, dayOfMonth: 7, narration: 'ECS/EMI/NORTHWIND FINANCE/LOAN' },
  { merchant: 'StreamNest', category: 'Subscriptions', method: 'Credit Card', amount: 499, jitter: 0, dayOfMonth: 9, narration: 'StreamNest Monthly Plan auto-renew' },
  { merchant: 'TuneWave Music', category: 'Subscriptions', method: 'Credit Card', amount: 119, jitter: 0, dayOfMonth: 14, narration: 'TuneWave Music Premium renewal' },
  { merchant: 'CloudVault Storage', category: 'Subscriptions', method: 'Credit Card', amount: 210, jitter: 0, dayOfMonth: 21, narration: 'CloudVault Storage 200GB plan' },
  { merchant: 'FitPulse Gym', category: 'Subscriptions', method: 'UPI', amount: 1499, jitter: 0, dayOfMonth: 2, narration: 'UPI/DR/AUTOPAY/FITPULSE GYM' },
  { merchant: 'Metro Power Board', category: 'Utilities', method: 'Net Banking', amount: 1850, jitter: 620, dayOfMonth: 12, narration: 'BILLPAY/METRO POWER BOARD/ELECTRICITY' },
  { merchant: 'AquaFlow Water Works', category: 'Utilities', method: 'Net Banking', amount: 430, jitter: 90, dayOfMonth: 17, narration: 'BILLPAY/AQUAFLOW WATER WORKS' },
  { merchant: 'FiberLink Broadband', category: 'Utilities', method: 'Auto Debit', amount: 999, jitter: 0, dayOfMonth: 23, narration: 'AUTOPAY/FIBERLINK BROADBAND 300MBPS' },
  { merchant: 'SafeGuard Insurance', category: 'Healthcare', method: 'Net Banking', amount: 6200, jitter: 0, dayOfMonth: 15, narration: 'PREMIUM/SAFEGUARD INSURANCE/HEALTH', everyMonths: 3 },
]

/** Planted outliers so anomaly detection has something real to find. */
interface OutlierSpec {
  monthsAgo: number
  day: number
  merchant: string
  category: Category
  method: PaymentMethod
  amount: number
  narration: string
}

const OUTLIERS: OutlierSpec[] = [
  { monthsAgo: 9, day: 18, merchant: 'GadgetHub Electronics', category: 'Shopping', method: 'Credit Card', amount: 38500, narration: 'POS 884211 GADGETHUB ELECTRONICS LAPTOP' },
  { monthsAgo: 6, day: 22, merchant: 'Verdant Jewellers', category: 'Shopping', method: 'Credit Card', amount: 42000, narration: 'POS 913744 VERDANT JEWELLERS' },
  { monthsAgo: 4, day: 11, merchant: 'City Clinic Labs', category: 'Healthcare', method: 'Debit Card', amount: 19800, narration: 'POS 774120 CITY CLINIC LABS PROCEDURE' },
  { monthsAgo: 2, day: 27, merchant: 'SkyFare Airways', category: 'Travel', method: 'Credit Card', amount: 26400, narration: 'POS 664301 SKYFARE AIRWAYS INTL' },
  { monthsAgo: 1, day: 6, merchant: 'Unknown Online Merchant', category: 'Other', method: 'Credit Card', amount: 11500, narration: 'POS 551902 UNKNOWN ONLINE MERCHANT' },
  { monthsAgo: 1, day: 6, merchant: 'Unknown Online Merchant', category: 'Other', method: 'Credit Card', amount: 11500, narration: 'POS 551903 UNKNOWN ONLINE MERCHANT RETRY' },
]

let counter = 0
function makeId(rnd: () => number): string {
  counter += 1
  return `sample-${counter.toString(36)}-${Math.floor(rnd() * 1e9).toString(36)}`
}

function gauss(rnd: () => number, mean: number, spread: number): number {
  // Box-Muller, clamped so no amount goes negative or absurd.
  const u = Math.max(rnd(), 1e-9)
  const v = rnd()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return Math.max(mean * 0.2, mean + z * spread * 0.5)
}

export interface SampleDataOptions {
  seed?: number
  months?: number
  /** Overrideable "today" so tests are not time-dependent. */
  today?: string
}

export function generateSampleTransactions(options: SampleDataOptions = {}): Transaction[] {
  const { seed = 20250419, months = 12 } = options
  const today = options.today ?? todayISO()
  const rnd = mulberry32(seed)
  counter = 0
  const now = Date.now()
  const out: Transaction[] = []

  const push = (
    date: string,
    description: string,
    merchant: string,
    rupees: number,
    type: TxnType,
    category: Category,
    paymentMethod: PaymentMethod,
    notes = '',
  ) => {
    out.push({
      id: makeId(rnd),
      date,
      description,
      merchant,
      amountPaise: toPaise(Math.round(rupees * 100) / 100),
      type,
      category,
      paymentMethod,
      notes,
      categorySource: 'sample',
      createdAt: now,
      updatedAt: now,
    })
  }

  // Month 0 = the oldest full month in the window.
  const startMonth = monthKey(addMonths(today, -(months - 1)))
  const monthKeys: string[] = []
  for (let i = 0; i < months; i++) monthKeys.push(monthKey(addMonths(`${startMonth}-01`, i)))

  const todayDate = parseISO(today)!

  const dayInMonth = (mk: string, day: number): string => {
    const [y, m] = mk.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return `${mk}-${`${Math.min(day, last)}`.padStart(2, '0')}`
  }
  const withinWindow = (iso: string) => {
    const d = parseISO(iso)
    return !!d && d <= todayDate
  }

  monthKeys.forEach((mk, monthIndex) => {
    const [, m] = mk.split('-').map(Number)
    // Gentle inflation plus a festive October/November bump: gives the
    // forecaster a real trend and a real seasonal effect to find.
    const trend = 1 + monthIndex * 0.012
    const festive = m === 10 || m === 11 ? 1.18 : m === 1 ? 0.9 : 1

    // --- income ---------------------------------------------------------
    const salary = 96000 + Math.round(monthIndex / 6) * 6000
    const salaryDate = dayInMonth(mk, 1)
    if (withinWindow(salaryDate)) {
      push(salaryDate, 'SALARY CREDIT NORTHWIND STUDIO', 'Northwind Studio', salary, 'income', 'Salary', 'Net Banking', 'Monthly salary')
    }
    if (rnd() < 0.35) {
      const d = dayInMonth(mk, 8 + Math.floor(rnd() * 14))
      if (withinWindow(d)) {
        push(d, 'NEFT/FREELANCE/BRIGHTPATH DESIGN', 'BrightPath Design', Math.round(gauss(rnd, 14000, 6000)), 'income', 'Other', 'Net Banking', 'Freelance project')
      }
    }
    if (monthIndex % 3 === 1) {
      const d = dayInMonth(mk, 19)
      if (withinWindow(d)) {
        push(d, 'DIVIDEND CREDIT INDEXWISE MUTUAL FUND', 'IndexWise Mutual Fund', Math.round(gauss(rnd, 3200, 900)), 'income', 'Investments', 'Net Banking', 'Dividend payout')
      }
    }

    // --- investments (an outgoing SIP) ------------------------------------
    const sipDate = dayInMonth(mk, 5)
    if (withinWindow(sipDate)) {
      push(sipDate, 'SIP/INDEXWISE MUTUAL FUND/MONTHLY', 'IndexWise Mutual Fund', 6000, 'expense', 'Investments', 'Auto Debit', 'Monthly SIP')
    }

    // --- recurring commitments --------------------------------------------
    for (const r of RECURRING) {
      if (r.everyMonths && monthIndex % r.everyMonths !== 0) continue
      const d = dayInMonth(mk, r.dayOfMonth)
      if (!withinWindow(d)) continue
      const amount = r.jitter ? Math.round(gauss(rnd, r.amount, r.jitter)) : r.amount
      push(d, r.narration, r.merchant, amount, 'expense', r.category, r.method, '')
    }

    // --- weekly recurring (exercises weekly frequency detection) -----------
    for (let w = 0; w < 5; w++) {
      const d = dayInMonth(mk, 4 + w * 7)
      if (!withinWindow(d)) continue
      push(d, 'UPI/DR/AUTOPAY/MORNINGFRESH MILK', 'MorningFresh Milk', 240, 'expense', 'Groceries', 'UPI', 'Weekly milk delivery')
    }

    // --- discretionary spending -------------------------------------------
    for (const spec of MERCHANTS) {
      const expected = spec.perMonth * trend * festive
      let n = Math.floor(expected)
      if (rnd() < expected - n) n += 1
      for (let k = 0; k < n; k++) {
        const day = 1 + Math.floor(rnd() * 28)
        const d = dayInMonth(mk, day)
        if (!withinWindow(d)) continue
        const ref = `${400000000 + Math.floor(rnd() * 99999999)}`
        const amount = Math.round(gauss(rnd, spec.mean * festive, spec.spread))
        const narration = spec.narration ? spec.narration(spec.merchant, ref) : `${spec.merchant} ${ref}`
        push(d, narration, spec.merchant, amount, 'expense', spec.category, spec.method, '')
      }
    }
  })

  // --- planted outliers ----------------------------------------------------
  for (const o of OUTLIERS) {
    const mk = monthKey(addMonths(today, -o.monthsAgo))
    const d = dayInMonth(mk, o.day)
    if (!withinWindow(d)) continue
    push(d, o.narration, o.merchant, o.amount, 'expense', o.category, o.method, 'Flagged as unusual by the sample dataset')
  }

  // --- a few recent days so "recent transactions" is never empty -----------
  for (let i = 1; i <= 4; i++) {
    const d = addDays(today, -i)
    const spec = MERCHANTS[Math.floor(rnd() * 6)]
    const ref = `${400000000 + Math.floor(rnd() * 99999999)}`
    push(d, upi(spec.merchant, ref), spec.merchant, Math.round(gauss(rnd, spec.mean, spec.spread)), 'expense', spec.category, spec.method, '')
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

/** Sample dataset facts used by tests and the Settings page. */
export function sampleDataSummary(txns: Transaction[]) {
  const months = new Set(txns.map((t) => monthKey(t.date)))
  const categories = new Set(txns.map((t) => t.category))
  return {
    count: txns.length,
    months: months.size,
    categories: categories.size,
    firstDate: txns[0]?.date ?? '',
    lastDate: txns[txns.length - 1]?.date ?? '',
  }
}

export { toISO }
