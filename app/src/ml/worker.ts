/// <reference lib="webworker" />
/**
 * Pyodide ML worker.
 *
 * Boots real CPython (WebAssembly) with numpy / pandas / scikit-learn /
 * statsmodels, loads `python/finsense_ml.py`, and executes ML jobs off the main
 * thread. The Python source is the same file the offline evaluation script runs,
 * so what the browser computes is what the README reports.
 *
 * The wheels are fetched once from the free jsDelivr CDN and then cached by the
 * browser. Only code is downloaded - no transaction data is ever uploaded.
 */

import type { MLRequest, MLResponse, MLProgressStage } from './protocol'
// `?raw` keeps one copy of the Python source: bundled for the browser, read from
// disk by the Node evaluation script.
import pythonSource from './python/finsense_ml.py?raw'

type PyodideAPI = {
  loadPackage: (names: string[]) => Promise<void>
  runPython: (code: string) => unknown
  globals: { get: (name: string) => unknown }
}

const PYODIDE_VERSION = '314.0.7'
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodide: PyodideAPI | null = null
let bootPromise: Promise<PyodideAPI> | null = null

function progress(stage: MLProgressStage, message: string) {
  const msg: MLResponse = { id: 0, kind: 'progress', stage, message }
  self.postMessage(msg)
}

async function boot(): Promise<PyodideAPI> {
  if (pyodide) return pyodide
  if (bootPromise) return bootPromise

  bootPromise = (async () => {
    progress('booting', 'Starting the Python runtime (WebAssembly)')
    const { loadPyodide } = await import('pyodide')
    const py = (await loadPyodide({ indexURL: INDEX_URL })) as unknown as PyodideAPI

    progress('loading-packages', 'Downloading scikit-learn, pandas and numpy (first run only)')
    await py.loadPackage(['numpy', 'pandas', 'scikit-learn'])
    try {
      // statsmodels is an optional cross-check for the forecaster.
      await py.loadPackage(['statsmodels'])
    } catch {
      // Forecasting degrades gracefully: finsense_ml.py try/excepts the import.
    }

    progress('importing', 'Loading the FinSense ML module')
    py.runPython(pythonSource)

    pyodide = py
    progress('done', 'Python ML runtime ready')
    return py
  })().catch((err) => {
    bootPromise = null
    throw err
  })

  return bootPromise
}

/** Call a Python entry point with a JSON string, return parsed JSON. */
function callPython(py: PyodideAPI, fn: string, payload: unknown): unknown {
  // The payload is assigned through globals rather than interpolated into the
  // source so that quotes and Unicode in merchant names cannot break the call.
  ;(py as unknown as { globals: { set: (k: string, v: unknown) => void } }).globals.set(
    '_payload',
    JSON.stringify(payload ?? {}),
  )
  const out = py.runPython(`${fn}(_payload)`)
  return JSON.parse(String(out))
}

self.onmessage = async (event: MessageEvent<MLRequest>) => {
  const { id, job, payload } = event.data
  const started = performance.now()
  try {
    const py = await boot()
    let data: unknown
    switch (job) {
      case 'runtime-info':
        data = JSON.parse(String(py.runPython('runtime_info()')))
        break
      case 'train-classifier':
        progress('running', 'Training and comparing classifiers')
        data = callPython(py, 'train_classifier', payload)
        break
      case 'predict-categories':
        progress('running', 'Predicting categories')
        data = callPython(py, 'predict_categories', payload)
        break
      case 'forecast':
        progress('running', 'Backtesting forecast models')
        data = callPython(py, 'forecast_expenses', payload)
        break
      case 'anomalies':
        progress('running', 'Fitting Isolation Forest')
        data = callPython(py, 'detect_anomalies', payload)
        break
      default:
        throw new Error(`Unknown ML job: ${job}`)
    }
    progress('done', 'Ready')
    const res: MLResponse = { id, kind: 'result', job, data, durationMs: performance.now() - started }
    self.postMessage(res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const res: MLResponse = { id, kind: 'error', job, message }
    self.postMessage(res)
  }
}
