/**
 * Message protocol between the UI thread and the Pyodide ML worker.
 *
 * All ML runs off the main thread, so training a Random Forest on 700+
 * transactions never freezes the interface. Progress messages drive the real
 * loading indicators (boot -> download wheels -> import -> fit).
 */

export type MLJob = 'train-classifier' | 'predict-categories' | 'forecast' | 'anomalies' | 'runtime-info'

export interface MLRequest {
  id: number
  job: MLJob
  payload: unknown
}

export type MLProgressStage = 'booting' | 'loading-packages' | 'importing' | 'running' | 'done'

export type MLResponse =
  | { id: number; kind: 'result'; job: MLJob; data: unknown; durationMs: number }
  | { id: number; kind: 'error'; job: MLJob; message: string }
  | { id: 0; kind: 'progress'; stage: MLProgressStage; message: string }

export interface ClassifierComparisonRow {
  model: string
  cvAccuracy: number | null
  cvStd: number | null
  testAccuracy: number
  macroF1: number
  error?: string
}

export interface ClassifierReport {
  ok: boolean
  message?: string
  bestModel?: string
  comparison?: ClassifierComparisonRow[]
  testAccuracy?: number
  macroF1?: number
  trainSize?: number
  testSize?: number
  totalSamples?: number
  classes?: string[]
  confusionMatrix?: { labels: string[]; matrix: number[][] }
  lowConfidenceThreshold?: number
  seed?: number
  sampleCount?: number
}

export interface CategoryPrediction {
  id: string
  category: string
  confidence: number
  uncertain: boolean
  runnerUp: string
  runnerUpConfidence: number
}

export interface PredictionResponse {
  ok: boolean
  message?: string
  predictions?: CategoryPrediction[]
  threshold?: number
}

export interface ForecastMetric {
  model: string
  mae: number
  rmse: number
  mape: number
  folds: number
}

export interface ForecastReport {
  ok: boolean
  message?: string
  needsMoreData?: boolean
  monthsAvailable?: number
  monthsRequired?: number
  bestModel?: string
  metrics?: ForecastMetric[]
  baselineMae?: number | null
  improvementVsBaseline?: number | null
  nextMonth?: string
  nextMonthPrediction?: number
  lower?: number
  upper?: number
  statsmodelsCrossCheck?: number | null
  history?: { month: string; actual: number }[]
  backtest?: { month: string; actual: number; predicted: number }[]
  categoryForecast?: {
    category: string
    predicted: number
    lastMonth: number
    average3m: number
    trendPerMonth: number
  }[]
  dailyForecast?: { date: string; predicted: number; lower: number; upper: number }[]
  highExpenseDays?: { dayOfMonth: number; averageSpend: number }[]
  expectedIncome?: number | null
  expectedSavings?: number | null
  monthsUsed?: number
  seed?: number
}

export interface AnomalyRecord {
  id: string
  date: string
  merchant: string
  description: string
  category: string
  amount: number
  score: number
  zScore: number
  reasons: string[]
}

export interface AnomalyReport {
  ok: boolean
  message?: string
  needsMoreData?: boolean
  model?: string
  contamination?: number
  analysed?: number
  flagged?: number
  anomalies?: AnomalyRecord[]
  features?: string[]
  disclaimer?: string
  seed?: number
}

export interface RuntimeInfo {
  python: string
  numpy: string
  pandas: string
  sklearn: string
  seed: number
}
