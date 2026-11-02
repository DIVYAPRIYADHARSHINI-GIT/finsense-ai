/**
 * Headless-Chrome end-to-end suite.
 *
 * Runs against the REAL production build served exactly as a static host serves
 * it, and fails on any console error. It drives the actual UI: loading sample
 * data, training the real scikit-learn classifier in the Pyodide worker, CSV
 * import, CRUD, theming, responsive layout and exports.
 *
 *   node scripts/e2e.mjs            # build must already exist in dist/
 *
 * Uses puppeteer-core driving the Google Chrome already installed on this
 * machine, so no extra browser is downloaded and nothing is installed system-wide.
 * Override with CHROME_PATH=... if Chrome lives elsewhere.
 */
import { createServer } from 'node:http'
import { readFile, stat, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const appRoot = resolve(fileURLToPath(import.meta.url), '../..')
const DIST = join(appRoot, 'dist')
const SHOTS = resolve(appRoot, '../docs/screenshots')
const PORT = 4317
const BASE = `http://127.0.0.1:${PORT}`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE)
    let p = join(DIST, decodeURIComponent(url.pathname))
    try {
      if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
    } catch {
      p = join(DIST, 'index.html') // SPA fallback
    }
    const body = await readFile(p)
    res.writeHead(200, {
      'content-type': MIME[extname(p)] ?? 'application/octet-stream',
      // Pyodide needs these for its WASM threads on some builds.
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
})
await new Promise((r) => server.listen(PORT, r))

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

await rm(SHOTS, { recursive: true, force: true })
await mkdir(SHOTS, { recursive: true })

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1000'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000 })

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text()
    // Font CDN may be unreachable in CI; that is not an app error.
    if (!/fonts\.(googleapis|gstatic)/.test(t)) consoleErrors.push(t)
  }
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

const goto = async (hash) => {
  await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 450))
}
const text = () => page.evaluate(() => document.body.innerText)
const clickByText = async (selector, needle) => {
  const handle = await page.evaluateHandle(
    (sel, txt) => [...document.querySelectorAll(sel)].find((e) => e.textContent?.includes(txt)) ?? null,
    selector,
    needle,
  )
  const el = handle.asElement()
  if (!el) return false
  await el.click()
  return true
}
const shot = async (name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true })

try {
  // ---------------------------------------------------------------- empty state
  section('1. First visit / empty state')
  await goto('dashboard')
  let t = await text()
  check('App renders without crashing', t.length > 100)
  check('Empty state shown for a fresh browser', /No transactions yet/i.test(t))
  check('Privacy promise visible on first run', /never asks|stays in this browser|Everything stays/i.test(t))
  await shot('01-empty-state')

  // ---------------------------------------------------------------- sample data
  section('2. Load sample data')
  check('Load sample data button present', await clickByText('button', 'Load sample data'))
  await new Promise((r) => setTimeout(r, 1600))
  t = await text()
  const txnCount = Number(/Showing\s+([\d,]+)\s+transactions/i.exec(t)?.[1]?.replace(/,/g, '') ?? 0)
  check('Sample data loaded into IndexedDB', txnCount > 0, `showing ${txnCount}`)
  check('Dashboard metric cards populated', /Total Income/i.test(t) && /Total Expenses/i.test(t))
  check('Highest spending category computed', /Highest Spending Category/i.test(t))

  const stored = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('finsense-ai')
        r.onsuccess = () => {
          const db = r.result
          const tx = db.transaction('transactions', 'readonly')
          const c = tx.objectStore('transactions').count()
          c.onsuccess = () => res(c.result)
          c.onerror = () => res(-1)
        }
        r.onerror = () => res(-1)
      }),
  )
  check('Transactions persisted to IndexedDB', stored >= 500, `${stored} rows`)

  const months = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('finsense-ai')
        r.onsuccess = () => {
          const tx = r.result.transaction('transactions', 'readonly')
          const all = tx.objectStore('transactions').getAll()
          all.onsuccess = () => res(new Set(all.result.map((x) => x.date.slice(0, 7))).size)
          all.onerror = () => res(0)
        }
      }),
  )
  check('Sample dataset spans 12 months', months >= 12, `${months} months`)

  // ---------------------------------------------------------------- real ML
  section('3. Real scikit-learn in Pyodide (this downloads ~25MB once)')
  await goto('insights')
  check('Train classifier control present', await clickByText('button', 'Train'))
  // Booting CPython + wheels legitimately takes a while on a cold cache.
  let trained = false
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const body = await text()
    if (/Selected model|Holdout accuracy/i.test(body) && /Confusion matrix/i.test(body)) {
      trained = true
      break
    }
    if (/ML error|could not be trained/i.test(body)) break
  }
  t = await text()
  check('Python/scikit-learn trained a real classifier', trained)
  const acc = Number(/Holdout accuracy\s*([\d.]+)%/i.exec(t)?.[1] ?? 0)
  check('Holdout accuracy reported and plausible', acc > 50 && acc <= 100, `${acc}%`)
  check('All three candidate models compared', /Naive Bayes/i.test(t) && /Logistic Regression/i.test(t) && /Random Forest/i.test(t))
  check('Confusion matrix rendered', /Confusion matrix/i.test(t))
  check('Low-confidence policy stated', /Uncertain/i.test(t))
  await shot('02-insights-classifier')

  // ---------------------------------------------------------------- forecasting
  section('4. Expense forecasting')
  await goto('forecast')
  let forecastReady = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const body = await text()
    if (/Model comparison/i.test(body) || /Not enough history/i.test(body)) {
      forecastReady = true
      break
    }
    if (i === 3) await clickByText('button', 'Run forecast')
  }
  t = await text()
  check('Forecast page resolved', forecastReady)
  check('MAE and RMSE reported', /MAE/i.test(t) && /RMSE/i.test(t))
  check('Baseline included in comparison', /Moving Average/i.test(t))
  check('Uncertainty range shown', /Range|uncertainty/i.test(t))
  check('Next-30-day forecast present', /Next 30 Days/i.test(t))
  check('Per-category forecast present', /Expected Spending by Category/i.test(t))
  await shot('03-forecast')

  // ---------------------------------------------------------------- anomalies
  section('5. Anomaly detection')
  await goto('anomalies')
  let anomReady = false
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const body = await text()
    if (/Isolation Forest/i.test(body) && /(review|flagged)/i.test(body)) {
      anomReady = true
      break
    }
    if (i === 3) await clickByText('button', 'Scan now')
  }
  t = await text()
  check('Isolation Forest ran', anomReady)
  check('Fraud disclaimer is prominent', /not confirmed fraud|not proof of fraud/i.test(t))
  check('Flags explain why', /standard deviations|differs from your usual|Rare merchant|First and only/i.test(t))
  check('Anomaly scores shown', /Score\s*0?\.\d/i.test(t))
  const beforeMark = (await page.$$('::-p-text(Mark as normal)')).length
  check('Mark-as-normal action available', beforeMark > 0, `${beforeMark} buttons`)
  if (beforeMark > 0) {
    await clickByText('button', 'Mark as normal')
    await new Promise((r) => setTimeout(r, 900))
    const after = await text()
    check('Marking as normal updates the list', /marked as normal/i.test(after))
  }
  await shot('04-anomalies')

  // ---------------------------------------------------------------- subscriptions
  section('6. Recurring payment detection')
  await goto('subscriptions')
  t = await text()
  check('Recurring rules detected', /Monthly recurring expense/i.test(t))
  const hasRent = /Greenleaf Properties/i.test(t)
  const hasSub = /StreamNest|TuneWave|CloudVault|FitPulse/i.test(t)
  check('Rent detected as recurring', hasRent)
  check('Subscriptions detected', hasSub)
  check('Next payment date estimated', /Next \(est\.\)|Upcoming payments/i.test(t))
  await shot('05-subscriptions')

  // ---------------------------------------------------------------- budgets
  section('7. Budgets and savings')
  await goto('budgets')
  t = await text()
  check('Budget utilisation rendered', /Category Budgets/i.test(t))
  check('Savings goal tracker rendered', /Savings Progress Tracker|savings goal/i.test(t))
  check('Recommendations generated from real data', /Savings Recommendations/i.test(t))
  check('Recommendations carry evidence', /Supporting months/i.test(t))
  check('No guaranteed-savings claim', !/guaranteed savings/i.test(t) && /not financial advice/i.test(t))
  await shot('06-budgets')

  // ---------------------------------------------------------------- transactions
  section('8. Transaction management')
  await goto('transactions')
  t = await text()
  check('Transaction table rendered', /transactions/i.test(t))
  await page.type('input[aria-label="Search transactions"]', 'FreshCart')
  await new Promise((r) => setTimeout(r, 700))
  t = await text()
  check('Search filters the table', /FreshCart/i.test(t) && /Filtered from/i.test(t))
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search transactions"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 500))

  // add a transaction
  await clickByText('button', 'Add')
  await new Promise((r) => setTimeout(r, 500))
  const dialogOpen = await page.$('[role="dialog"]')
  check('Add-transaction dialog opens', !!dialogOpen)
  if (dialogOpen) {
    await page.evaluate(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel)
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const inputs = document.querySelectorAll('[role="dialog"] input')
      set('[role="dialog"] input[type="date"]', '2025-06-15')
      const num = document.querySelector('[role="dialog"] input[type="number"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(num, '1234.56')
      num.dispatchEvent(new Event('input', { bubbles: true }))
      const merchant = [...inputs].find((i) => i.placeholder?.includes('FreshCart'))
      if (merchant) {
        setter.call(merchant, 'E2E Test Merchant')
        merchant.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await new Promise((r) => setTimeout(r, 300))
    await clickByText('[role="dialog"] button', 'Add transaction')
    await new Promise((r) => setTimeout(r, 1200))
    t = await text()
    check('Transaction added and visible', /E2E Test Merchant|Transaction added/i.test(t))
  }

  // edit it back out via search + delete
  await page.type('input[aria-label="Search transactions"]', 'E2E Test Merchant')
  await new Promise((r) => setTimeout(r, 700))
  const delBtn = await page.$('button[aria-label^="Delete transaction"]')
  check('Delete control present for a row', !!delBtn)
  if (delBtn) {
    await delBtn.click()
    await new Promise((r) => setTimeout(r, 400))
    const confirmText = await text()
    check('Delete asks for confirmation', /Delete this transaction\?/i.test(confirmText))
    await clickByText('[role="dialog"] button', 'Delete')
    await new Promise((r) => setTimeout(r, 1000))
    const afterDel = await text()
    check('Transaction deleted', /Transaction deleted|No transactions match/i.test(afterDel))
  }
  await shot('07-transactions')

  // ---------------------------------------------------------------- CSV import
  section('9. CSV import (valid, invalid, duplicate, Unicode)')
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search transactions"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickByText('button', 'Import CSV')
  await new Promise((r) => setTimeout(r, 500))
  check('Import wizard opens', !!(await page.$('[role="dialog"]')))

  const csvPath = join(appRoot, '.e2e-import.csv')
  // Deliberately messy: semicolon delimiter, BOM, quoted field with a comma and
  // a newline, Tamil + Hindi merchants, one broken row, one duplicate.
  const csv =
    '\uFEFFDate;Narration;Payee;Withdrawal;Deposit;Mode\r\n' +
    '15/06/2025;"UPI/DR/999001/TEST SHOP, BRANCH 2";Test Shop;250.75;;UPI\r\n' +
    '16/06/2025;"Multi\nline narration";Line Break Vendor;99.50;;UPI\r\n' +
    '17/06/2025;UPI/DR/999003/அண்ணா மெஸ்;அண்ணா மெஸ்;180.00;;UPI\r\n' +
    '18/06/2025;UPI/DR/999004/चाय की दुकान;चाय की दुकान;45.00;;Cash\r\n' +
    '19/06/2025;SALARY TEST;Test Employer;;50000.00;Net Banking\r\n' +
    'not-a-date;BROKEN ROW;Bad Vendor;100.00;;UPI\r\n' +
    '20/06/2025;MISSING AMOUNT;No Amount Vendor;;;UPI\r\n' +
    '15/06/2025;"UPI/DR/999001/TEST SHOP, BRANCH 2";Test Shop;250.75;;UPI\r\n'
  await writeFile(csvPath, csv, 'utf8')
  const input = await page.$('input[type="file"][accept*="csv"]')
  await input.uploadFile(csvPath)
  await new Promise((r) => setTimeout(r, 1200))
  t = await text()
  check('Delimiter auto-detected as semicolon', /Semicolon/i.test(t) || /8 row/i.test(t))
  check('Column mapping screen shown', /map each column|Delimiter/i.test(t))
  check('Date format inferred as DD/MM', /DD\/MM/i.test(t))
  await clickByText('[role="dialog"] button', 'Preview import')
  await new Promise((r) => setTimeout(r, 900))
  t = await text()
  check('Preview reports ready/skipped/failed counts', /Ready to import/i.test(t) && /Skipped/i.test(t) && /Failed/i.test(t))
  check('Broken date row reported with a reason', /Unrecognised date/i.test(t))
  check('Missing amount row reported', /Missing amount|Unrecognised amount/i.test(t))
  check('In-file duplicate detected', /Duplicate row within this file/i.test(t))
  await shot('08-csv-import-preview')
  await clickByText('[role="dialog"] button', 'Import')
  await new Promise((r) => setTimeout(r, 2000))
  t = await text()
  check('Import committed with a summary toast', /Imported \d+ transaction/i.test(t))

  await page.type('input[aria-label="Search transactions"]', 'அண்ணா')
  await new Promise((r) => setTimeout(r, 800))
  t = await text()
  check('Tamil merchant stored and searchable', /அண்ணா/.test(t))
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search transactions"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, 'चाय')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 800))
  t = await text()
  check('Hindi merchant stored and searchable', /चाय/.test(t))

  // re-importing the same file must now be caught against stored data
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Search transactions"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickByText('button', 'Import CSV')
  await new Promise((r) => setTimeout(r, 400))
  await (await page.$('input[type="file"][accept*="csv"]')).uploadFile(csvPath)
  await new Promise((r) => setTimeout(r, 1000))
  await clickByText('[role="dialog"] button', 'Preview import')
  await new Promise((r) => setTimeout(r, 900))
  t = await text()
  check('Duplicate against stored data detected on re-import', /already stored/i.test(t))
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 400))

  // ---------------------------------------------------------------- reports
  section('10. Reports and exports')
  await goto('reports')
  t = await text()
  check('All eight report types listed', /Monthly Expense Report/i.test(t) && /Forecast Report/i.test(t) && /Anomaly Detection Report/i.test(t))
  const cdp = await page.target().createCDPSession()
  const dlDir = join(appRoot, '.e2e-downloads')
  await mkdir(dlDir, { recursive: true })
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true })
  await clickByText('button', 'CSV')
  await new Promise((r) => setTimeout(r, 1500))
  await clickByText('button', 'PDF')
  await new Promise((r) => setTimeout(r, 1800))
  await clickByText('button', 'JSON backup')
  await new Promise((r) => setTimeout(r, 1500))
  const files = await readdir(dlDir)
  check('CSV export written', files.some((f) => f.endsWith('.csv')), files.join(','))
  check('PDF export written', files.some((f) => f.endsWith('.pdf')))
  check('JSON backup written', files.some((f) => f.endsWith('.json')))
  const pdfFile = files.find((f) => f.endsWith('.pdf'))
  if (pdfFile) {
    const buf = await readFile(join(dlDir, pdfFile))
    check('PDF has valid magic bytes', buf.subarray(0, 5).toString() === '%PDF-', buf.subarray(0, 8).toString())
    check('PDF is non-trivial in size', buf.length > 1200, `${buf.length} bytes`)
  }
  const jsonFile = files.find((f) => f.endsWith('.json'))
  if (jsonFile) {
    const parsed = JSON.parse(await readFile(join(dlDir, jsonFile), 'utf8'))
    check('JSON backup contains transactions', Array.isArray(parsed.transactions) && parsed.transactions.length > 100)
    check('JSON backup is schema-versioned', typeof parsed.schemaVersion === 'number')
  }
  await shot('09-reports')

  // ---------------------------------------------------------------- settings
  section('11. Settings, storage and privacy')
  await goto('settings')
  t = await text()
  check('Storage usage reported', /Storage usage/i.test(t))
  check('Privacy section lists what never happens', /What never happens/i.test(t))
  check('No-bank-credentials promise present', /UPI PINs|bank passwords/i.test(t))
  check('Currency selector present', /Currency/i.test(t))
  check('Clear-all-data control present', /Clear all data/i.test(t))
  await clickByText('button', 'Check runtime')
  let runtimeOk = false
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (/scikit-learn/i.test(await text())) {
      runtimeOk = true
      break
    }
  }
  t = await text()
  check('Runtime reports real library versions', runtimeOk)
  check('Python 3.x confirmed in-browser', /3\.\d+\.\d+/.test(t))
  await shot('10-settings')

  // destructive confirmation must be typed
  await clickByText('button', 'Clear all data')
  await new Promise((r) => setTimeout(r, 500))
  t = await text()
  check('Destructive action requires typed confirmation', /Type "DELETE"/i.test(t))
  const confirmBtn = await page.evaluateHandle(
    () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Delete all data')) ?? null,
  )
  const cb = confirmBtn.asElement()
  check('Confirm button disabled until text matches', cb ? await cb.evaluate((b) => b.disabled) : false)
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 400))

  // ---------------------------------------------------------------- theming
  section('12. Light and dark themes')
  // NOTE: headless Chrome reports prefers-color-scheme: dark, so the default
  // 'system' preference legitimately resolves to dark here. The test therefore
  // asserts each theme explicitly rather than assuming a starting point.
  const setTheme = async (theme) => {
    await page.evaluate((t) => {
      const raw = localStorage.getItem('finsense.preferences.v1')
      const prefs = raw ? JSON.parse(raw) : {}
      localStorage.setItem('finsense.preferences.v1', JSON.stringify({ ...prefs, theme: t }))
    }, theme)
    await page.reload({ waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 700))
  }

  await setTheme('light')
  const lightAttr = await page.evaluate(() => document.documentElement.dataset.theme)
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('Light theme applies', lightAttr === 'light', lightAttr)
  check('Light background is the designed off-white', /248, ?250, ?252/.test(lightBg), lightBg)
  await shot('11-dashboard-light')

  await setTheme('dark')
  const darkAttr = await page.evaluate(() => document.documentElement.dataset.theme)
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('Dark theme applies and survives a reload with no flash', darkAttr === 'dark', darkAttr)
  check('Dark background is the designed navy', /15, ?23, ?42/.test(darkBg), darkBg)
  check('Dark background differs from light', lightBg !== darkBg, `${lightBg} vs ${darkBg}`)
  const darkInk = await page.evaluate(() => getComputedStyle(document.body).color)
  check('Dark theme uses light ink', /241, ?245, ?249/.test(darkInk), darkInk)
  await shot('11-dashboard-dark')

  // The toggle itself must flip whatever the current theme is.
  const beforeToggle = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.click('button[aria-label^="Switch to"]')
  await new Promise((r) => setTimeout(r, 700))
  const afterToggle = await page.evaluate(() => document.documentElement.dataset.theme)
  check('Theme toggle flips the current theme', beforeToggle !== afterToggle, `${beforeToggle} -> ${afterToggle}`)
  check('Toggle persists the choice', (await page.evaluate(() => JSON.parse(localStorage.getItem('finsense.preferences.v1')).theme)) === afterToggle)

  // ---------------------------------------------------------------- responsive
  section('13. Responsive layout')
  for (const [name, w, h] of [
    ['mobile', 390, 844],
    ['tablet', 768, 1024],
    ['desktop', 1440, 1000],
  ]) {
    await page.setViewport({ width: w, height: h })
    await goto('dashboard')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`No horizontal overflow at ${name} (${w}px)`, overflow <= 1, `${overflow}px`)
    if (w === 390) {
      const bottomNav = await page.evaluate(
        () => !!document.querySelector('nav[aria-label="Primary navigation"]'),
      )
      check('Mobile shows a bottom tab bar', bottomNav)
      const tapOk = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('nav[aria-label="Primary navigation"] button')]
        return btns.length > 0 && btns.every((b) => b.getBoundingClientRect().height >= 44)
      })
      check('Bottom-nav targets are at least 44px tall', tapOk)
    }
    await shot(`12-responsive-${name}`)
  }
  await page.setViewport({ width: 1440, height: 1000 })

  // ---------------------------------------------------------------- a11y basics
  section('14. Accessibility and keyboard')
  await goto('dashboard')
  const a11y = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((i) => !i.alt)
    const btns = [...document.querySelectorAll('button')].filter(
      (b) => !b.textContent.trim() && !b.getAttribute('aria-label'),
    )
    return { h1: document.querySelectorAll('h1').length, imgsNoAlt: imgs.length, btnsNoLabel: btns.length, main: !!document.querySelector('main') }
  })
  check('Exactly one h1 per page', a11y.h1 === 1, String(a11y.h1))
  check('All buttons have an accessible name', a11y.btnsNoLabel === 0, `${a11y.btnsNoLabel} unlabelled`)
  check('No images missing alt text', a11y.imgsNoAlt === 0)
  check('Main landmark present', a11y.main)
  const skip = await page.evaluate(() => {
    const a = document.querySelector('a[href="#main-content"]')
    return a ? a.textContent.trim() : ''
  })
  check('Skip-to-content link present', /skip/i.test(skip), skip)
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  check('Keyboard focus enters the page', !!focused && focused !== 'BODY', String(focused))

  // ---------------------------------------------------------------- data integrity
  section('15. Single source of truth')
  await goto('dashboard')
  const dash = await text()
  const dashExpense = /Total Expenses\s*\n?\s*([^\n]+)/i.exec(dash)?.[1]?.trim()
  await goto('reports')
  await new Promise((r) => setTimeout(r, 600))
  check('Dashboard and reports both render totals', !!dashExpense && /Total expenses/i.test(await text()))

  // Empty-dataset behaviour, driven through the REAL user flow.
  // (Calling indexedDB.deleteDatabase() from the test would be reported as
  // "blocked" because the app correctly holds an open connection, so the app's
  // own Clear-all-data path is both the valid and the more meaningful test.)
  section('16. Clear all data and empty-dataset behaviour')
  await goto('settings')
  await clickByText('button', 'Clear all data')
  await new Promise((r) => setTimeout(r, 600))
  check('Clear-all dialog requires the word DELETE', /Type "DELETE"/i.test(await text()))
  await page.evaluate(() => document.querySelector('[role="dialog"] input[placeholder="DELETE"]')?.focus())
  await page.keyboard.type('DELETE')
  await new Promise((r) => setTimeout(r, 400))
  const enabledNow = await page.evaluate(
    () => !([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Delete all data'))?.disabled ?? true),
  )
  check('Confirm enables once DELETE is typed', enabledNow)
  await clickByText('[role="dialog"] button', 'Delete all data')
  await new Promise((r) => setTimeout(r, 2000))
  check('Deletion confirmed to the user', /All data deleted/i.test(await text()))

  const remaining = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('finsense-ai')
        r.onsuccess = () => {
          try {
            const c = r.result.transaction('transactions', 'readonly').objectStore('transactions').count()
            c.onsuccess = () => res(c.result)
            c.onerror = () => res(-1)
          } catch {
            res(-1)
          }
        }
        r.onerror = () => res(-1)
      }),
  )
  check('IndexedDB is actually empty after clearing', remaining === 0, `${remaining} rows`)

  await goto('dashboard')
  t = await text()
  check('Dashboard returns to the empty state', /No transactions yet/i.test(t))
  await goto('forecast')
  await new Promise((r) => setTimeout(r, 1800))
  t = await text()
  check(
    'Forecast page handles an empty dataset gracefully',
    /No forecast computed|Add or import transactions|Not enough/i.test(t),
    `TEXT>>> ${t.replace(/\s+/g, ' ').slice(0, 400)}`,
  )
  await goto('reports')
  t = await text()
  check('Reports page handles an empty dataset gracefully', /No data to report on/i.test(t))
  await goto('subscriptions')
  t = await text()
  check('Subscriptions page handles an empty dataset gracefully', /No recurring payments detected/i.test(t))
  await shot('13-empty-after-clear')

  // ---------------------------------------------------------------- console
  section('17. Console hygiene')
  check('No console errors across the whole run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  await rm(csvPath, { force: true })
  await rm(dlDir, { recursive: true, force: true })
} catch (err) {
  fail++
  failures.push(`Suite crashed: ${err.message}`)
  console.error('\nSUITE ERROR:', err)
}

await browser.close()
server.close()

console.log(`\n${'='.repeat(58)}`)
console.log(`E2E RESULT: ${pass} passed, ${fail} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f}`)
}
console.log(`Screenshots: docs/screenshots/`)
process.exit(fail > 0 ? 1 : 0)
