/**
 * ML model test suite.
 *
 * Runs the real `src/ml/python/finsense_ml.py` under the same Pyodide build the
 * browser uses, and asserts behaviour rather than just printing metrics:
 * reproducibility, insufficient-data refusals, low-confidence handling, and
 * that each model actually learns something.
 *
 *   node scripts/ml-tests.mjs
 */
import { loadPyodide } from 'pyodide'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` - ${detail}` : ''}`)
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n== ${t} ==`)

// --- dataset from the real generator ---------------------------------------
const probe = resolve(appRoot, '.mltest-dataset.mjs')
writeFileSync(
  probe,
  `import { generateSampleTransactions } from './src/lib/sample-data.ts'
const txns = generateSampleTransactions({ today: '2025-11-02' })
process.stdout.write(JSON.stringify(txns.map(t => ({
  id: t.id, date: t.date, description: t.description, merchant: t.merchant,
  amount: t.amountPaise / 100, type: t.type, category: t.category,
}))))`,
)
const records = JSON.parse(
  execFileSync('npx', ['tsx', probe], { cwd: appRoot, maxBuffer: 64 * 1024 * 1024 }).toString(),
)
execFileSync('rm', ['-f', probe])

console.log('Booting Pyodide with numpy / pandas / scikit-learn / statsmodels...')
const py = await loadPyodide({ packageCacheDir: resolve(appRoot, '.pyodide-cache') })
await py.loadPackage(['numpy', 'pandas', 'scikit-learn', 'statsmodels'])
py.runPython(readFileSync(resolve(appRoot, 'src/ml/python/finsense_ml.py'), 'utf8'))
const call = (fn, payload) => {
  py.globals.set('_payload', JSON.stringify(payload))
  return JSON.parse(String(py.runPython(`${fn}(_payload)`)))
}

// ---------------------------------------------------------------------------
section('Runtime')
const rt = JSON.parse(py.runPython('runtime_info()'))
check('Real CPython 3.x is running', /^3\.\d+\.\d+$/.test(rt.python), rt.python)
check('scikit-learn is a real version', /^\d+\.\d+\.\d+$/.test(rt.sklearn), rt.sklearn)
check('pandas is a real version', /^\d+\.\d+\.\d+$/.test(rt.pandas), rt.pandas)
check('Random seed is fixed for reproducibility', rt.seed === 42, String(rt.seed))

// ---------------------------------------------------------------------------
section('Text preprocessing')
const pre = (s) => String(py.runPython(`preprocess(${JSON.stringify(s)})`))
check('Lowercases and strips reference numbers', !/402938471/.test(pre('UPI/DR/402938471/SWIGGY')))
check('Keeps the merchant token', /swiggy/.test(pre('UPI/DR/402938471/SWIGGY')))
check('Preserves Tamil codepoints', /[\u0B80-\u0BFF]/.test(pre('UPI/DR/1/அண்ணா மெஸ்')))
check('Preserves Devanagari codepoints', /[\u0900-\u097F]/.test(pre('UPI/DR/1/चाय की दुकान')))
check('Empty input yields empty output', pre('') === '')

// ---------------------------------------------------------------------------
section('ML Module 1: classification')
const samples = records
  .filter((r) => r.merchant || r.description)
  .map((r) => ({ merchant: r.merchant, description: r.description, category: r.category }))

const tooFew = call('train_classifier', { samples: samples.slice(0, 10) })
check('Refuses to train on too little data', tooFew.ok === false && /at least 30/.test(tooFew.message))
check('Refusal explains what to do', /Import or categorise more|load the sample/i.test(tooFew.message))

const clf = call('train_classifier', { samples })
check('Trains successfully on the sample dataset', clf.ok === true)
check('Compares all three required classifiers', (clf.comparison ?? []).length === 3)
check(
  'Naive Bayes, Logistic Regression and Random Forest all present',
  ['Multinomial Naive Bayes', 'Logistic Regression', 'Random Forest'].every((m) =>
    clf.comparison.some((c) => c.model === m),
  ),
)
check('No candidate model errored', clf.comparison.every((c) => !c.error), JSON.stringify(clf.comparison.filter((c) => c.error)))
check('Holdout accuracy is well above chance', clf.testAccuracy > 0.5, `${(clf.testAccuracy * 100).toFixed(2)}%`)
check('Cross-validated accuracy reported for the winner', clf.comparison.some((c) => c.model === clf.bestModel && c.cvAccuracy > 0.5))
check('Macro F1 reported', clf.macroF1 > 0.4, String(clf.macroF1))
check('Confusion matrix is square and matches its labels', (() => {
  const { labels, matrix } = clf.confusionMatrix
  return matrix.length === labels.length && matrix.every((r) => r.length === labels.length)
})())
check('Confusion matrix totals equal the test-set size', (() => {
  const total = clf.confusionMatrix.matrix.flat().reduce((a, b) => a + b, 0)
  return total === clf.testSize
})(), `${clf.confusionMatrix.matrix.flat().reduce((a, b) => a + b, 0)} vs ${clf.testSize}`)
check('Train and test sets are disjoint sizes that sum sensibly', clf.trainSize > clf.testSize && clf.testSize > 0)
check('Trained on many distinct narrations, not a handful', clf.totalSamples > 100, `${clf.totalSamples} unique`)

// reproducibility
const clf2 = call('train_classifier', { samples })
check('Training is reproducible with the fixed seed', clf2.testAccuracy === clf.testAccuracy && clf2.bestModel === clf.bestModel)

section('ML Module 1: prediction')
const preds = call('predict_categories', {
  items: [
    { id: 'rent', merchant: 'Greenleaf Properties', description: 'NACH/RENT/GREENLEAF PROPERTIES' },
    { id: 'sub', merchant: 'StreamNest', description: 'StreamNest Monthly Plan auto-renew' },
    { id: 'blank', merchant: '', description: '' },
    { id: 'unknown', merchant: 'Zzqqxx Vendor', description: 'POS 000000 ZZQQXX VENDOR' },
  ],
})
check('Prediction returns a row per input', preds.predictions.length === 4)
check('Every confidence is a probability', preds.predictions.every((p) => p.confidence >= 0 && p.confidence <= 1))
const rent = preds.predictions.find((p) => p.id === 'rent')
check('Recognises a known rent narration', rent.category === 'Rent', `${rent.category} @ ${rent.confidence.toFixed(2)}`)
const sub = preds.predictions.find((p) => p.id === 'sub')
check('Recognises a known subscription narration', sub.category === 'Subscriptions', `${sub.category} @ ${sub.confidence.toFixed(2)}`)
const blank = preds.predictions.find((p) => p.id === 'blank')
check('Blank input is reported as uncertain, not guessed', blank.uncertain === true && blank.confidence === 0)
const unknown = preds.predictions.find((p) => p.id === 'unknown')
check('An unseen merchant yields low confidence', unknown.confidence < 0.6, String(unknown.confidence.toFixed(2)))
check('Low-confidence rows are flagged uncertain', unknown.uncertain === true)
check('Threshold is reported to the UI', preds.threshold > 0 && preds.threshold < 1)
check('A runner-up category is provided for review', preds.predictions.every((p) => typeof p.runnerUp === 'string'))

// ---------------------------------------------------------------------------
section('ML Module 2: forecasting')
const shortFc = call('forecast_expenses', { records: records.slice(0, 20), today: '2025-11-02' })
check('Refuses to forecast on insufficient history', shortFc.ok === false && shortFc.needsMoreData === true)
check('Reports how many months are available vs required', shortFc.monthsAvailable >= 0 && shortFc.monthsRequired === 4)
check('Refusal message is actionable', /unlocks automatically|Keep adding/i.test(shortFc.message))

const emptyFc = call('forecast_expenses', { records: [], today: '2025-11-02' })
check('Handles a completely empty dataset', emptyFc.ok === false && /No expense transactions/i.test(emptyFc.message))

const fc = call('forecast_expenses', { records, today: '2025-11-02' })
check('Forecasts on the full sample dataset', fc.ok === true)
check('Excludes the incomplete current month', fc.monthsUsed === 11, `${fc.monthsUsed} months`)
check('Compares the regressors against a moving-average baseline', fc.metrics.length === 3)
check('Baseline is present by name', fc.metrics.some((m) => m.model === 'Moving Average (baseline)'))
check('Every model reports MAE and RMSE', fc.metrics.every((m) => m.mae > 0 && m.rmse > 0))
check('RMSE is never below MAE', fc.metrics.every((m) => m.rmse >= m.mae - 1e-6))
check('Selected model is the lowest-MAE model', fc.bestModel === fc.metrics[0].model)
check('Prediction is a positive figure', fc.nextMonthPrediction > 0)
check('Uncertainty range brackets the prediction', fc.lower <= fc.nextMonthPrediction && fc.nextMonthPrediction <= fc.upper)
check('Lower bound is never negative', fc.lower >= 0)
check('Next month label follows the last complete month', fc.nextMonth === '2025-11', fc.nextMonth)
check('Backtest has multiple walk-forward folds', fc.backtest.length >= 3, `${fc.backtest.length} folds`)
check('Statsmodels cross-check produced a value', typeof fc.statsmodelsCrossCheck === 'number' && fc.statsmodelsCrossCheck > 0)
check('Daily horizon covers 30 days', fc.dailyForecast.length === 30)
check('Daily forecasts carry an uncertainty band', fc.dailyForecast.every((d) => d.lower <= d.predicted && d.predicted <= d.upper))
check('Daily forecast roughly reconciles with the monthly total', (() => {
  const sum = fc.dailyForecast.reduce((a, d) => a + d.predicted, 0)
  return Math.abs(sum - fc.nextMonthPrediction) / fc.nextMonthPrediction < 0.25
})(), `daily sum ${fc.dailyForecast.reduce((a, d) => a + d.predicted, 0).toFixed(0)} vs ${fc.nextMonthPrediction.toFixed(0)}`)
check('Category forecast sums to the monthly prediction', (() => {
  const sum = fc.categoryForecast.reduce((a, c) => a + c.predicted, 0)
  return Math.abs(sum - fc.nextMonthPrediction) < 1
})())
check('High-expense days identified', fc.highExpenseDays.length > 0)
check('Expected income derived from recorded income', fc.expectedIncome > 0)
check('Expected savings is income minus predicted expenses', Math.abs(fc.expectedSavings - (fc.expectedIncome - fc.nextMonthPrediction)) < 1)

const fc2 = call('forecast_expenses', { records, today: '2025-11-02' })
check('Forecasting is reproducible', fc2.nextMonthPrediction === fc.nextMonthPrediction)

// ---------------------------------------------------------------------------
section('ML Module 3: anomaly detection')
const tooFewAnom = call('detect_anomalies', { records: records.slice(0, 10) })
check('Refuses to scan with too few transactions', tooFewAnom.ok === false && tooFewAnom.needsMoreData === true)
check('Refusal states the minimum', /at least 25/.test(tooFewAnom.message))

const an = call('detect_anomalies', { records, contamination: 0.04 })
check('Isolation Forest runs on the sample dataset', an.ok === true && an.model === 'Isolation Forest')
check('Flag rate approximates the contamination setting', Math.abs(an.flagged / an.analysed - 0.04) < 0.02, `${((an.flagged / an.analysed) * 100).toFixed(1)}%`)
check('Scores are normalised to 0..1', an.anomalies.every((a) => a.score >= 0 && a.score <= 1))
check('Results are sorted by descending score', an.anomalies.every((a, i, arr) => i === 0 || arr[i - 1].score >= a.score))
check('Every flag carries at least one reason', an.anomalies.every((a) => a.reasons.length > 0))
check('Reasons are human-readable sentences', an.anomalies.every((a) => a.reasons[0].length > 15))
check('Feature list is exposed for transparency', an.features.length === 6)
check('Disclaimer states that unusual is not fraud', /not proof of fraud/i.test(an.disclaimer))
check('No flag is labelled as confirmed fraud', !JSON.stringify(an.anomalies).toLowerCase().includes('fraud'))

// recall on the deliberately planted outliers
const PLANTED = [
  'GADGETHUB ELECTRONICS LAPTOP',
  'VERDANT JEWELLERS',
  'CITY CLINIC LABS PROCEDURE',
  'SKYFARE AIRWAYS INTL',
  'UNKNOWN ONLINE MERCHANT',
]
const planted = records.filter((r) => PLANTED.some((n) => r.description.toUpperCase().includes(n)))
const flaggedIds = new Set(an.anomalies.map((a) => a.id))
const caught = planted.filter((r) => flaggedIds.has(r.id)).length
check('Catches the planted outliers', caught === planted.length, `${caught}/${planted.length}`)

// recurring commitments should mostly NOT be flagged
const rentRows = records.filter((r) => r.description.includes('NACH/RENT'))
const rentFlagged = rentRows.filter((r) => flaggedIds.has(r.id)).length
check('Does not flag regular rent as anomalous', rentFlagged <= 1, `${rentFlagged}/${rentRows.length} flagged`)

// marking as normal removes a row from the next scan
const firstId = an.anomalies[0].id
const rescan = call('detect_anomalies', { records, ignoredIds: [firstId], contamination: 0.04 })
check('Ignored transactions are excluded from a re-scan', !rescan.anomalies.some((a) => a.id === firstId))
check('Re-scan analyses one fewer transaction', rescan.analysed === an.analysed - 1, `${rescan.analysed} vs ${an.analysed}`)

const an2 = call('detect_anomalies', { records, contamination: 0.04 })
check('Anomaly detection is reproducible', an2.anomalies[0].id === an.anomalies[0].id && an2.flagged === an.flagged)

// sensitivity actually changes behaviour
const strict = call('detect_anomalies', { records, contamination: 0.01 })
const loose = call('detect_anomalies', { records, contamination: 0.1 })
check('Lower contamination flags fewer transactions', strict.flagged < an.flagged, `${strict.flagged} < ${an.flagged}`)
check('Higher contamination flags more transactions', loose.flagged > an.flagged, `${loose.flagged} > ${an.flagged}`)

// ---------------------------------------------------------------------------
section('Unicode end-to-end through the ML layer')
// Narrations must VARY: the trainer de-duplicates identical text, because N
// copies of one string carry no more information than one copy. Real
// statements vary by outlet/terminal, so this fixture does too.
const outlets = ['KORAMANGALA', 'INDIRANAGAR', 'WHITEFIELD', 'JAYANAGAR', 'HSR', 'BTM', 'ECOM', 'QR', 'APP', 'TID', 'TRM', 'POS']
const uni = call('train_classifier', {
  samples: [
    ...outlets.map((o) => ({ merchant: 'அண்ணா மெஸ்', description: `UPI/DR/1/அண்ணா மெஸ் லஞ்ச்/${o}`, category: 'Food & Dining' })),
    ...outlets.map((o) => ({ merchant: 'चाय की दुकान', description: `UPI/DR/2/चाय की दुकान/${o}`, category: 'Food & Dining' })),
    ...outlets.map((o) => ({ merchant: 'FreshCart', description: `UPI/DR/3/FRESHCART SUPERMARKET/${o}`, category: 'Groceries' })),
    ...outlets.map((o) => ({ merchant: 'Greenleaf', description: `NACH/RENT/GREENLEAF/${o}`, category: 'Rent' })),
  ],
})
check('Trains on Tamil/Hindi narrations without error', uni.ok === true, uni.message ?? '')
if (uni.ok) {
  const upred = call('predict_categories', {
    items: [{ id: 'ta', merchant: 'அண்ணா மெஸ்', description: 'UPI/DR/9/அண்ணா மெஸ் லஞ்ச்' }],
  })
  check('Predicts a Tamil merchant correctly', upred.predictions[0].category === 'Food & Dining', upred.predictions[0].category)
}

console.log(`\n${'='.repeat(58)}`)
console.log(`ML TESTS: ${pass} passed, ${fail} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
process.exit(fail > 0 ? 1 : 0)
