/**
 * Live-site verification against the deployed production URL.
 *
 * Nothing here is mocked or served locally: it drives the real Vercel
 * deployment, boots real Pyodide + scikit-learn in the real browser, and fails
 * on any console error.
 *
 *   node scripts/live-check.mjs https://finsense-ai-rho.vercel.app
 */
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'https://finsense-ai-rho.vercel.app'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let pass = 0, fail = 0
const failures = []
const check = (n, ok, d = '') => {
  if (ok) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; failures.push(`${n}${d ? ` - ${d}` : ''}`); console.log(`  FAIL  ${n}${d ? ` - ${d}` : ''}`) }
}
const section = (t) => console.log(`\n== ${t} ==`)

console.log(`Verifying LIVE deployment: ${BASE}\n`)

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 1000 })

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

const text = () => page.evaluate(() => document.body.innerText)
const clickText = async (sel, t) => {
  const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent?.includes(x)) ?? null, sel, t)
  const el = h.asElement()
  if (!el) return false
  await el.click()
  return true
}
const goto = async (h) => { await page.goto(`${BASE}/#/${h}`, { waitUntil: 'networkidle2' }); await new Promise((r) => setTimeout(r, 700)) }

try {
  section('1. Deployment reachable and serving the app')
  const res = await page.goto(BASE, { waitUntil: 'networkidle2' })
  check('HTTP 200 from production URL', res.status() === 200, `HTTP ${res.status()}`)
  check('Served over HTTPS', BASE.startsWith('https://'))
  const title = await page.title()
  check('Correct page title', /FinSense AI/.test(title), title)
  await new Promise((r) => setTimeout(r, 900))
  let t = await text()
  check('App mounted (not a blank shell)', t.length > 200, `${t.length} chars`)
  check('Empty state shown on first visit', /No transactions yet/i.test(t))

  section('2. Sample data on the live site')
  check('Load sample data button present', await clickText('button', 'Load sample data'))
  await new Promise((r) => setTimeout(r, 2500))
  t = await text()
  check('Dashboard populated from IndexedDB', /Total Income/i.test(t) && /Total Expenses/i.test(t))
  const rows = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('finsense-ai')
    r.onsuccess = () => { const c = r.result.transaction('transactions', 'readonly').objectStore('transactions').count(); c.onsuccess = () => res(c.result) }
    r.onerror = () => res(-1)
  }))
  check('500+ transactions persisted in the live browser', rows >= 500, `${rows} rows`)

  section('3. REAL scikit-learn training on the live deployment')
  await goto('insights')
  await clickText('button', 'Train')
  let trained = false
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const b = await text()
    if (/Holdout accuracy/i.test(b) && /Confusion matrix/i.test(b)) { trained = true; break }
    if (/ML error/i.test(b)) break
  }
  t = await text()
  check('Pyodide booted and trained a model on the live site', trained)
  const acc = Number(/Holdout accuracy\s*([\d.]+)%/i.exec(t)?.[1] ?? 0)
  check('Live holdout accuracy is real and plausible', acc > 50 && acc <= 100, `${acc}%`)
  check('All three classifiers compared live', /Naive Bayes/i.test(t) && /Logistic Regression/i.test(t) && /Random Forest/i.test(t))

  section('4. Forecast and anomaly modules live')
  await goto('forecast')
  let fc = false
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if (/Model comparison|Not enough history/i.test(await text())) { fc = true; break }
    if (i === 2) await clickText('button', 'Run forecast')
  }
  t = await text()
  check('Forecast computed live', fc)
  check('MAE/RMSE reported live', /MAE/i.test(t) && /RMSE/i.test(t))

  await goto('anomalies')
  let an = false
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    if (/Isolation Forest/i.test(await text())) { an = true; break }
    if (i === 2) await clickText('button', 'Scan now')
  }
  t = await text()
  check('Isolation Forest ran live', an)
  check('Not-fraud disclaimer present live', /not confirmed fraud|not proof of fraud/i.test(t))

  section('5. All nine routes render on the live site')
  for (const r of ['dashboard', 'transactions', 'insights', 'forecast', 'anomalies', 'subscriptions', 'budgets', 'reports', 'settings']) {
    await goto(r)
    const body = await text()
    check(`/${r} renders`, body.length > 300, `${body.length} chars`)
  }

  section('6. Deep-link refresh (SPA rewrite works)')
  await page.goto(`${BASE}/#/budgets`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 1200))
  check('Deep link survives a hard refresh', /Category Budgets|savings goal/i.test(await text()))

  section('7. Responsive on the live site')
  for (const [n, w, h] of [['mobile', 390, 844], ['tablet', 768, 1024]]) {
    await page.setViewport({ width: w, height: h })
    await goto('dashboard')
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`No horizontal overflow at ${n} (${w}px) live`, o <= 1, `${o}px`)
  }
  await page.setViewport({ width: 1440, height: 1000 })

  section('8. No paid services reachable from the client')
  const hosts = new Set()
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).host) } catch {} })
  await goto('dashboard')
  await new Promise((r) => setTimeout(r, 1500))
  const external = [...hosts].filter((h) => !h.includes('vercel.app') && !h.includes('127.0.0.1'))
  const allowed = external.every((h) => /jsdelivr|fonts\.googleapis|fonts\.gstatic/.test(h))
  check('Only free CDNs contacted (jsDelivr / Google Fonts)', allowed, external.join(', ') || 'none')

  section('9. Console hygiene on the live site')
  check('No console errors on the live deployment', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (err) {
  fail++
  failures.push(`Suite crashed: ${err.message}`)
  console.error('SUITE ERROR:', err)
}

await browser.close()
console.log(`\n${'='.repeat(56)}`)
console.log(`LIVE SITE: ${pass} passed, ${fail} failed`)
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  - ${f}`) }
process.exit(fail > 0 ? 1 : 0)
