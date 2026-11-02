// Diagnostic: which element overflows the viewport at 390px, on every page?
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const DIST = resolve(fileURLToPath(import.meta.url), '../../dist')
const PORT = 4319
const BASE = `http://127.0.0.1:${PORT}`
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }

const server = createServer(async (req, res) => {
  try {
    let p = join(DIST, new URL(req.url, BASE).pathname)
    try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html') } catch { p = join(DIST, 'index.html') }
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' })
    res.end(await readFile(p))
  } catch { res.writeHead(404).end() }
})
await new Promise((r) => server.listen(PORT, r))

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
})
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844 })

// seed sample data once
await page.goto(`${BASE}/#/dashboard`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))
const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Load sample data')) ?? null)
if (btn.asElement()) { await btn.asElement().click(); await new Promise((r) => setTimeout(r, 2000)) }

for (const route of ['dashboard', 'transactions', 'insights', 'forecast', 'anomalies', 'subscriptions', 'budgets', 'reports', 'settings']) {
  await page.goto(`${BASE}/#/${route}`, { waitUntil: 'networkidle2' })
  await new Promise((r) => setTimeout(r, 900))
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const overflow = document.documentElement.scrollWidth - vw
    if (overflow <= 1) return { overflow, culprits: [] }
    const culprits = []
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        culprits.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 90),
          right: Math.round(r.right),
          left: Math.round(r.left),
          w: Math.round(r.width),
          text: (el.textContent ?? '').trim().slice(0, 40),
        })
      }
    }
    // Only report the deepest offenders (a parent is usually just containing a child).
    return { overflow, vw, culprits: culprits.slice(0, 12) }
  })
  console.log(`\n--- /${route} : overflow ${result.overflow}px (vw ${result.vw ?? ''}) ---`)
  for (const c of result.culprits) console.log(`   <${c.tag} class="${c.cls}"> left=${c.left} right=${c.right} w=${c.w}  "${c.text}"`)
}

await browser.close()
server.close()
