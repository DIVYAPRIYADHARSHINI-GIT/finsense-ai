/** Props every page receives from App. Keeps ML coordination in one place. */

import type { AnomalyRecord, AnomalyReport, ClassifierReport, ForecastReport } from '../ml/protocol'
import type { MLStatus } from '../store/useMLWorker'
import type { RouteId } from '../components/AppShell'

export interface MLState {
  classifier: ClassifierReport | null
  forecast: ForecastReport | null
  anomalies: AnomalyReport | null
  /** Transaction count each result was computed against; used to detect staleness. */
  classifierRows: number | null
  forecastRows: number | null
  anomalyRows: number | null
  trainingClassifier: boolean
  forecasting: boolean
  scanning: boolean
}

export interface PageProps {
  ml: MLState
  mlStatus: MLStatus
  trainClassifier: () => Promise<ClassifierReport | null>
  runForecast: () => Promise<ForecastReport | null>
  runAnomalyScan: () => Promise<AnomalyReport | null>
  predictAndApply: (ids: string[]) => Promise<void>
  navigate: (r: RouteId) => void
  visibleAnomalies: AnomalyRecord[]
}
