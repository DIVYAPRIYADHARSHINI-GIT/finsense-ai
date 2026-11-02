/**
 * Offline ML evaluation harness.
 *
 * Runs the EXACT same `src/ml/python/finsense_ml.py` the browser runs, through
 * the same project-local Pyodide build, against the same deterministic sample
 * dataset the app ships. The metrics it prints are therefore the metrics the
 * app produces - nothing is transcribed by hand.
 *
 *   node scripts/evaluate-ml.mjs            # human-readable report
 *   node scripts/evaluate-ml.mjs --json     # machine-readable, for tests
 *
 * No Python installation is required on the host: Pyodide is a devDependency.
 */
import { loadPyodide } from 'pyodide'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const asJSON = process.argv.includes('--json')
let reportExtra = null
const log = (...a) => { if (!asJSON) console.log(...a) }

// --- 1. produce the sample dataset from the real TypeScript generator -------
log('Generating the sample dataset from src/lib/sample-data.ts ...')
const probe = resolve(appRoot, '.ml-eval-dataset.mjs')
writeFileSync(
  probe,
  `import { generateSampleTransactions } from './src/lib/sample-data.ts'
const txns = generateSampleTransactions({ today: '2025-11-02' })
process.stdout.write(JSON.stringify(txns.map(t => ({
  id: t.id, date: t.date, description: t.description, merchant: t.merchant,
  amount: t.amountPaise / 100, type: t.type, category: t.category,
}))))`,
)
const datasetJSON = execFileSync('npx', ['tsx', probe], { cwd: appRoot, maxBuffer: 64 * 1024 * 1024 }).toString()
const records = JSON.parse(datasetJSON)
execFileSync('rm', ['-f', probe])
log(`  ${records.length} transactions, ${new Set(records.map(r => r.date.slice(0, 7))).size} months`)

// --- 2. boot the same Pyodide runtime the browser uses ----------------------
log('Booting Pyodide (CPython -> WebAssembly) ...')
const py = await loadPyodide({ packageCacheDir: resolve(appRoot, '.pyodide-cache') })
await py.loadPackage(['numpy', 'pandas', 'scikit-learn', 'statsmodels'])
py.runPython(readFileSync(resolve(appRoot, 'src/ml/python/finsense_ml.py'), 'utf8'))
const runtime = JSON.parse(py.runPython('runtime_info()'))
log(`  Python ${runtime.python}, numpy ${runtime.numpy}, pandas ${runtime.pandas}, scikit-learn ${runtime.sklearn}`)

const call = (fn, payload) => {
  py.globals.set('_payload', JSON.stringify(payload))
  return JSON.parse(String(py.runPython(`${fn}(_payload)`)))
}

// --- 3. classification ------------------------------------------------------
log('\n[ML MODULE 1] Expense classification')
const samples = records
  .filter((r) => r.merchant || r.description)
  .map((r) => ({ merchant: r.merchant, description: r.description, category: r.category }))
const clf = call('train_classifier', { samples })
if (clf.ok) {
  log(`  best model      : ${clf.bestModel}`)
  log(`  holdout accuracy: ${(clf.testAccuracy * 100).toFixed(2)}%`)
  log(`  macro F1        : ${clf.macroF1.toFixed(4)}`)
  log(`  train / test    : ${clf.trainSize} / ${clf.testSize} (${clf.totalSamples} unique narrations)`)
  log('  model comparison:')
  for (const c of clf.comparison) {
    if (c.error) { log(`    - ${c.model}: FAILED ${c.error}`); continue }
    log(`    - ${c.model.padEnd(24)} cv=${c.cvAccuracy === null ? ' n/a ' : (c.cvAccuracy * 100).toFixed(2) + '%'} test=${(c.testAccuracy * 100).toFixed(2)}% f1=${c.macroF1.toFixed(3)}`)
  }
} else {
  log(`  NOT TRAINED: ${clf.message}`)
}

// prediction sanity check on held-out-ish unseen narrations
const probeItems = [
  { id: 'p1', merchant: 'FreshCart Supermarket', description: 'UPI/DR/402938471/FRESHCART SUPERMARKET' },
  { id: 'p2', merchant: 'StreamNest', description: 'StreamNest Monthly Plan auto-renew' },
  { id: 'p3', merchant: 'Greenleaf Properties', description: 'NACH/RENT/GREENLEAF PROPERTIES' },
  { id: 'p4', merchant: '', description: '' },
  { id: 'p5', merchant: 'Zzqx Unknown Vendor', description: 'POS 999999 ZZQX UNKNOWN VENDOR' },
]
const preds = call('predict_categories', { items: probeItems })
log('  spot predictions:')
for (const p of preds.predictions ?? []) {
  log(`    ${p.id}: ${p.category.padEnd(16)} conf=${(p.confidence * 100).toFixed(1)}%${p.uncertain ? '  <- Uncertain - Review Category' : ''}`)
}

// --- 4. forecasting ----------------------------------------------------------
log('\n[ML MODULE 2] Expense forecasting')
const fc = call('forecast_expenses', { records, today: '2025-11-02' })
if (fc.ok) {
  log(`  best model   : ${fc.bestModel}`)
  log(`  next month   : ${fc.nextMonth} -> ${fc.nextMonthPrediction.toFixed(0)} (range ${fc.lower.toFixed(0)} - ${fc.upper.toFixed(0)})`)
  log(`  months used  : ${fc.monthsUsed}`)
  log(`  statsmodels  : ${fc.statsmodelsCrossCheck === null ? 'unavailable' : fc.statsmodelsCrossCheck.toFixed(0)} (Holt-Winters cross-check)`)
  log('  backtest metrics (walk-forward):')
  for (const m of fc.metrics) {
    log(`    - ${m.model.padEnd(26)} MAE=${m.mae.toFixed(0)} RMSE=${m.rmse.toFixed(0)} MAPE=${m.mape.toFixed(1)}% folds=${m.folds}`)
  }
  log(`  vs baseline  : ${fc.improvementVsBaseline === null ? 'n/a' : fc.improvementVsBaseline.toFixed(1) + '% better MAE'}`)
  log(`  categories   : ${fc.categoryForecast.length} forecast, top = ${fc.categoryForecast[0]?.category} ${fc.categoryForecast[0]?.predicted.toFixed(0)}`)
  log(`  daily horizon: ${fc.dailyForecast.length} days`)
} else {
  log(`  NOT FORECAST: ${fc.message}`)
}

// insufficient-data behaviour
const shortFc = call('forecast_expenses', { records: records.slice(0, 12), today: '2025-11-02' })
log(`  short-history guard: ok=${shortFc.ok} needsMoreData=${shortFc.needsMoreData === true} -> "${(shortFc.message ?? '').slice(0, 70)}..."`)

// --- 5. anomaly detection -----------------------------------------------------
log('\n[ML MODULE 3] Anomaly detection')
const an = call('detect_anomalies', { records, contamination: 0.04 })
if (an.ok) {
  log(`  model    : ${an.model}`)
  log(`  analysed : ${an.analysed}, flagged ${an.flagged} (${((an.flagged / an.analysed) * 100).toFixed(1)}%)`)
  log('  top flags:')
  for (const a of an.anomalies.slice(0, 6)) {
    log(`    ${a.date}  ${a.amount.toFixed(0).padStart(7)}  ${a.merchant.slice(0, 26).padEnd(26)} score=${a.score.toFixed(3)} z=${a.zScore.toFixed(1)}`)
    log(`        why: ${a.reasons[0]}`)
  }
  // Recall against the OUTLIERS planted by the sample generator. Measured by
  // matching the exact narrations the generator uses, not by "amount is large":
  // rent and the SIP are large every month and are correctly NOT anomalies.
  const PLANTED_NARRATIONS = [
    'GADGETHUB ELECTRONICS LAPTOP',
    'VERDANT JEWELLERS',
    'CITY CLINIC LABS PROCEDURE',
    'SKYFARE AIRWAYS INTL',
    'UNKNOWN ONLINE MERCHANT',
  ]
  const planted = records.filter((r) =>
    PLANTED_NARRATIONS.some((n) => r.description.toUpperCase().includes(n)),
  )
  const flaggedIds = new Set(an.anomalies.map((a) => a.id))
  const caught = planted.filter((r) => flaggedIds.has(r.id))
  log(`  planted-outlier recall: ${caught.length}/${planted.length} deliberately planted outliers flagged`)
  for (const p of planted) {
    log(`    ${flaggedIds.has(p.id) ? 'FOUND  ' : 'MISSED '} ${p.date} ${p.amount.toFixed(0).padStart(6)} ${p.merchant}`)
  }
  // Recurring commitments must NOT be flagged - that would be a false positive.
  const rentRows = records.filter((r) => r.description.includes('NACH/RENT'))
  const rentFlagged = rentRows.filter((r) => flaggedIds.has(r.id)).length
  log(`  rent false-positives  : ${rentFlagged}/${rentRows.length} (lower is better; rent is normal)`)
  reportExtra = {
    plantedTotal: planted.length,
    plantedCaught: caught.length,
    rentRows: rentRows.length,
    rentFlagged,
  }
} else {
  log(`  NOT RUN: ${an.message}`)
}

const report = {
  runtime,
  dataset: { transactions: records.length, months: new Set(records.map((r) => r.date.slice(0, 7))).size },
  classification: clf,
  predictions: preds,
  forecast: fc,
  shortForecast: shortFc,
  anomalies: an,
  anomalyQuality: reportExtra,
}
mkdirSync(resolve(appRoot, '../docs'), { recursive: true })
writeFileSync(resolve(appRoot, '../docs/ml-evaluation.json'), JSON.stringify(report, null, 2))
if (asJSON) process.stdout.write(JSON.stringify(report))
else console.log('\nWrote docs/ml-evaluation.json')
