// Smoke test: does the project-local Pyodide really load numpy/pandas/scikit-learn?
// Run with: node scripts/pyodide-check.mjs
import { loadPyodide } from 'pyodide'
import { readFileSync } from 'node:fs'

const t0 = Date.now()
const py = await loadPyodide({ packageCacheDir: '.pyodide-cache' })
console.log('pyodide booted in', Date.now() - t0, 'ms')
await py.loadPackage(['numpy', 'pandas', 'scikit-learn', 'statsmodels'])
console.log('packages loaded in', Date.now() - t0, 'ms')
py.runPython(readFileSync(new URL('../src/ml/python/finsense_ml.py', import.meta.url), 'utf8'))
console.log(py.runPython('runtime_info()'))
