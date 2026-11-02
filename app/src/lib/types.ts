/**
 * FinSense AI domain types.
 *
 * Money is stored in **paise** (integer minor units) everywhere in the store so
 * that totals, budgets, savings rates and exported reports can never disagree
 * by a floating-point cent. Conversion to rupees happens only at the UI edge
 * and when handing data to the Python ML layer (which works in major units).
 */

export const CATEGORIES = [
  'Food & Dining',
  'Shopping',
  'Transportation',
  'Rent',
  'Utilities',
  'Healthcare',
  'Entertainment',
  'Education',
  'Travel',
  'Subscriptions',
  'Groceries',
  'Salary',
  'Investments',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

export const INCOME_CATEGORIES: Category[] = ['Salary', 'Investments', 'Other']

export const PAYMENT_METHODS = [
  'UPI',
  'Debit Card',
  'Credit Card',
  'Net Banking',
  'Cash',
  'Auto Debit',
  'Wallet',
  'Other',
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export type TxnType = 'income' | 'expense'

export interface Transaction {
  id: string
  /** Civil date, `YYYY-MM-DD`. Never a Date object or an instant: a transaction
   *  belongs to the calendar day the bank recorded, regardless of time zone. */
  date: string
  description: string
  merchant: string
  /** Signed-free integer paise. `type` carries the direction. */
  amountPaise: number
  type: TxnType
  category: Category
  paymentMethod: PaymentMethod
  notes: string
  /** How the category was decided. `ml` rows are safe to re-predict; `user`
   *  and `import` rows are treated as ground truth for training. */
  categorySource: 'user' | 'ml' | 'import' | 'sample'
  /** Confidence of the last ML prediction, 0..1, when categorySource === 'ml'. */
  mlConfidence?: number
  createdAt: number
  updatedAt: number
}

export interface Budget {
  /** `category` budgets plus the special `__total__` monthly cap. */
  category: Category | '__total__'
  limitPaise: number
}

export interface RecurringRule {
  id: string
  /** Lower-cased merchant key the detector grouped on. */
  merchantKey: string
  name: string
  merchant: string
  category: Category
  averagePaise: number
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  intervalDays: number
  occurrences: number
  lastDate: string
  nextDate: string
  confidence: number
  status: 'detected' | 'confirmed' | 'dismissed'
  txnIds: string[]
}

export interface Settings {
  currency: 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD'
  dateFormat: 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd MMM yyyy'
  theme: 'light' | 'dark' | 'system'
  monthlySavingsGoalPaise: number
  /** Minimum ML confidence before a predicted category is auto-applied. */
  autoApplyConfidence: number
  anomalyContamination: number
  reducedMotion: boolean
}

export interface InsightFeedback {
  /** Stable hash of the insight so dismissals survive recomputation. */
  key: string
  state: 'dismissed' | 'useful'
  at: number
}

export interface AppData {
  schemaVersion: number
  transactions: Transaction[]
  budgets: Budget[]
  recurring: RecurringRule[]
  settings: Settings
  /** Transactions the user marked "this is normal" in anomaly detection. */
  ignoredAnomalyIds: string[]
  insightFeedback: InsightFeedback[]
}

export const SCHEMA_VERSION = 2

export const DEFAULT_SETTINGS: Settings = {
  currency: 'INR',
  dateFormat: 'dd MMM yyyy',
  theme: 'system',
  monthlySavingsGoalPaise: 2000000, // Rs 20,000
  autoApplyConfidence: 0.55,
  anomalyContamination: 0.04,
  reducedMotion: false,
}

export const CURRENCY_META: Record<Settings['currency'], { symbol: string; locale: string }> = {
  INR: { symbol: '\u20B9', locale: 'en-IN' },
  USD: { symbol: '$', locale: 'en-US' },
  EUR: { symbol: '\u20AC', locale: 'de-DE' },
  GBP: { symbol: '\u00A3', locale: 'en-GB' },
  JPY: { symbol: '\u00A5', locale: 'ja-JP' },
  AUD: { symbol: 'A$', locale: 'en-AU' },
}
