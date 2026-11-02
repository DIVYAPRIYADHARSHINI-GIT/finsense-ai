# FinSense AI

> **Understand your money. Predict your future. Spend smarter.**

A privacy-first personal finance intelligence app with **real machine learning**:
scikit-learn runs inside your browser through Pyodide (CPython 3.14 compiled to
WebAssembly) in a Web Worker. No server, no paid API, no cloud database, no
account, no tracking. Every transaction stays in your own browser's IndexedDB.

**Live app:** https://finsense-ai-rho.vercel.app
**Repository:** https://github.com/DIVYAPRIYADHARSHINI-GIT/finsense-ai

**Project folder:** `/Users/softage/Designer Projects/starter/finsense-ai`
**App folder:** `/Users/softage/Designer Projects/starter/finsense-ai/app`

---

## 1. Is the ML real?

Yes, and it is verifiable. The file [`app/src/ml/python/finsense_ml.py`](app/src/ml/python/finsense_ml.py)
is **one** Python module executed in two places:

1. In the browser, by Pyodide, with the genuine `numpy` / `pandas` /
   `scikit-learn` / `statsmodels` wheels.
2. On a developer machine by [`app/scripts/evaluate-ml.mjs`](app/scripts/evaluate-ml.mjs),
   which is how the metrics below are produced.

Because it is the same file against the same deterministic dataset, the numbers
in this README are the numbers the app computes. Click **Settings → Check
runtime** in the running app and it will print the live library versions:

```
Python 3.14.2 | NumPy 2.4.6 | Pandas 3.0.2 | scikit-learn 1.8.0 | seed 42
```

There is no hardcoded prediction, no random number standing in for a model, and
no LLM anywhere in the product.

---

## 2. Measured ML performance

Produced by `npm run ml:evaluate` on the bundled 745-transaction sample dataset.
Full output: [`docs/ml-evaluation.json`](docs/ml-evaluation.json).

### Module 1 — Expense classification (TF-IDF + 3 classifiers compared)

| Model | CV accuracy | Holdout accuracy | Macro F1 |
| --- | --- | --- | --- |
| **Random Forest (selected)** | 96.69% | **99.00%** | **0.9957** |
| Logistic Regression | 97.02% | 99.00% | 0.9640 |
| Multinomial Naive Bayes | 95.36% | 98.00% | 0.8940 |

404 unique narrations, 304 train / 100 holdout, stratified. A confusion matrix
is rendered in-app on the AI Insights page. Predictions below 55% confidence are
labelled **"Uncertain – Review Category"** instead of being applied silently.

### Module 2 — Expense forecasting (walk-forward backtest, 6 folds)

| Model | MAE | RMSE | MAPE |
| --- | --- | --- | --- |
| **Moving Average baseline (selected)** | **₹18,562** | ₹19,484 | 18.6% |
| Random Forest Regressor | ₹20,045 | ₹23,625 | 19.1% |
| Linear Regression | ₹35,577 | ₹45,484 | 32.2% |

**An honest finding, surfaced in the UI:** with only 11 complete months of
history the 3-month moving average beats both regressors, so the app *uses and
reports the baseline* rather than claiming a fancier model won. The Forecast
page explains this in plain language. ML regressors typically overtake the
baseline at 18–24 months. A statsmodels Holt-Winters value (₹105,422 vs the
selected ₹101,156) is shown as an independent cross-check.

### Module 3 — Anomaly detection (Isolation Forest)

- 725 expense transactions analysed, 29 flagged (4.0%, matching the contamination setting)
- **6/6 deliberately planted outliers caught**
- Only 1/11 recurring rent charges flagged (recurring commitments are correctly treated as normal)
- Every flag carries a human-readable reason derived from the same features the model scored
- Nothing is ever labelled as confirmed fraud

---

## 3. Test results

All four suites were executed; these are real counts, not estimates.

| Suite | Command | Result |
| --- | --- | --- |
| Unit / integration (Vitest) | `npm test` | **106 passed, 0 failed** |
| ML model tests (real Python) | `npm run test:ml` | **77 passed, 0 failed** |
| End-to-end (headless Chrome) | `npm run test:e2e` | **101 passed, 0 failed** |
| **Live deployment** | `npm run test:live` | **29 passed, 0 failed** |
| Lint (oxlint) | `npm run lint` | 0 errors, 13 warnings |
| Typecheck (tsc) | `npx tsc -b` | clean |
| Production build | `npm run build` | **success**, 874 kB JS (251 kB gzip) |

**Total: 313 automated checks passing.** The E2E suite runs against the real
production build served as a static host serves it, and **fails on any console
error** — the final run had zero.

### Mapping to the 25 requested test scenarios

| # | Scenario | Where |
| --- | --- | --- |
| 1 | Valid CSV upload | E2E §9 + `csv.test.ts` |
| 2 | Invalid CSV upload | E2E §9 (broken date row reported) |
| 3 | Duplicate transaction detection | E2E §9 (in-file + against stored) |
| 4 | Missing transaction values | E2E §9 + `csv.test.ts` |
| 5 | Add / edit / delete | E2E §8 |
| 6 | Automatic classification | ML §1 + E2E §3 |
| 7 | Low-confidence classification | ML §1 (blank + unseen merchant) |
| 8 | ML model training | ML §1, E2E §3 |
| 9 | Model evaluation | ML §1 (confusion matrix totals) |
| 10 | Next-month prediction | ML §2, E2E §4 |
| 11 | Forecast with insufficient data | ML §2 (refusal asserted) |
| 12 | Anomaly detection | ML §3, E2E §5 |
| 13 | Mark anomaly as normal | ML §3 + E2E §5 |
| 14 | Recurring payment detection | `analytics.test.ts`, E2E §6 |
| 15 | Monthly budget calculation | `analytics.test.ts` (incl. pace alerts) |
| 16 | Savings recommendation | `analytics.test.ts`, E2E §7 |
| 17 | Dashboard updates | E2E §2, §15 |
| 18 | JSON backup and restore | `storage.test.ts`, E2E §10 |
| 19 | Storage quota errors | `storage.test.ts` (classified errors) |
| 20 | Empty transaction dataset | E2E §16 (all pages) |
| 21 | Light theme | E2E §12 |
| 22 | Dark theme | E2E §12 (separate palette verified) |
| 23 | Mobile responsiveness | E2E §13 (390 px, zero overflow) |
| 24 | Desktop responsiveness | E2E §13 (768 / 1440 px) |
| 25 | Unicode and Tamil text | `csv.test.ts`, ML Unicode section, E2E §9 |

### Real bugs the suites found and fixed

1. **Modal keystroke loss** — the dialog's focus effect depended on an unstable
   `onClose`, so it re-ran on every keystroke and its cleanup stole focus back.
   Typing `DELETE` into the clear-data confirmation only ever registered `D`.
2. **Stale ML results after clearing data** — the Forecast page kept showing
   "trained on 17 complete months" after the user deleted everything. Fixed by
   tagging each result with the dataset it describes and resolving staleness at
   render time rather than racing it in an effect.
3. **45 px horizontal overflow at 390 px** — centred metric tooltips (320 px
   fixed) and a Recharts container that ratcheted its card to 400 px.
4. **Meaningless classifier accuracy** — the first evaluation reported 28% CV
   accuracy because every charge at one merchant produced an identical
   narration, collapsing 745 rows to 45 unique strings. The sample generator now
   varies narrations by outlet/terminal like real statements, taking CV accuracy
   to 96.7% on a genuine generalisation task.
5. **Regressors losing to the baseline** — they had no calendar features and so
   could not see the festive-season bump; added cyclical month encoding,
   momentum and a festive flag.
6. **Misleading anomaly recall metric** — my own metric counted recurring rent
   as a "missed outlier". Replaced with recall against the deliberately planted
   outliers plus a rent false-positive rate.

---

## 4. Setup and commands

Requires **Node.js 20+** only. No Python installation is needed on your machine:
Pyodide is a project-local npm dependency, and the browser downloads the
scikit-learn wheels itself on first use.

```bash
cd "/Users/softage/Designer Projects/starter/finsense-ai/app"
npm install          # install dependencies
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | **Production build** → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | 106 unit / integration tests |
| `npm run test:ml` | 77 ML tests against real scikit-learn |
| `npm run test:e2e` | 101 headless-Chrome checks (needs `npm run build` first) |
| `npm run test:live` | 29 checks against the deployed production URL |
| `npm run test:all` | Lint → unit → ML → build → E2E |
| `npm run ml:evaluate` | Regenerate `docs/ml-evaluation.json` |
| `npm run lint` | oxlint |
| `npm run build:pages` | Build with a `/finsense-ai/` base path for GitHub Pages |

The E2E suite uses `puppeteer-core` driving the Google Chrome already installed
on this Mac — **no browser is downloaded and nothing is installed system-wide**.
Point it elsewhere with `CHROME_PATH=/path/to/chrome npm run test:e2e`.

---

## 5. Architecture

```
finsense-ai/
├── app/
│   ├── src/
│   │   ├── ml/
│   │   │   ├── python/finsense_ml.py   ← ALL ML: the 3 modules, one file
│   │   │   ├── worker.ts               ← Pyodide boot + job dispatch (Web Worker)
│   │   │   └── protocol.ts             ← typed UI↔worker message contract
│   │   ├── lib/                        ← pure logic, no React
│   │   │   ├── types.ts      money in integer paise, 14 categories
│   │   │   ├── money.ts      the only float→money conversion point
│   │   │   ├── dates.ts      civil YYYY-MM-DD, local-noon anchoring
│   │   │   ├── csv.ts        RFC4180 parser, delimiter sniffing, BOM
│   │   │   ├── import.ts     CSV→Transaction with row-level diagnostics
│   │   │   ├── analytics.ts  every metric and chart series (pure)
│   │   │   ├── recurring.ts  periodicity detection
│   │   │   ├── insights.ts   insights + savings recommendations
│   │   │   ├── storage.ts    IndexedDB, migrations, backup/restore
│   │   │   ├── pdf.ts        dependency-free PDF writer
│   │   │   └── sample-data.ts seeded fictional dataset
│   │   ├── store/AppStore.tsx          ← THE single source of truth
│   │   ├── components/                 ← hand-built UI kit + charts
│   │   ├── pages/                      ← the 9 navigation destinations
│   │   └── tests/                      ← 106 Vitest tests
│   └── scripts/                        ← ML eval, ML tests, E2E, diagnostics
└── docs/
    ├── screenshots/                    ← 16 screenshots of every page
    └── ml-evaluation.json              ← machine-readable ML metrics
```

### Why these choices

| Concern | Choice | Why it is free |
| --- | --- | --- |
| Frontend | React 19 + TypeScript + Vite + Tailwind 4 + Recharts + lucide-react | MIT / OSS |
| ML runtime | **Pyodide (Option A)** — real CPython + scikit-learn in a Web Worker | Runs on your CPU, no API, no GPU |
| Storage | IndexedDB (transactions) + localStorage (preferences) | Browser built-ins |
| PDF export | Hand-written PDF 1.4 writer with Helvetica AFM metrics | No library, no licence |
| Hosting | Static `dist/` → Vercel Hobby or GitHub Pages | Free tier, no billing |

**Option A was chosen over a FastAPI backend** because Pyodide 314 genuinely
ships `numpy`, `pandas`, `scikit-learn`, `scipy` and `statsmodels` wheels — this
was verified before any UI was written. It keeps the privacy promise absolute
(there is no server that *could* receive your data) and keeps hosting free and
static forever.

### Single source of truth

There is exactly one transaction array, in `AppStore`. Dashboards, reports,
forecasts, budgets and insights are all *derived* from it by the pure functions
in `lib/analytics.ts`. Nothing is precomputed or cached, which is why editing one
transaction instantly corrects every page and no view can go stale. Money is
stored in **integer paise** so 745 summed transactions cannot drift by a cent.

---

## 6. Features

**Dashboard** — 8 live metrics, 7 charts (income vs expenses, category donut,
weekly trends, monthly history, savings growth, predicted vs actual, top
categories), recent transactions, insights, budget progress, upcoming payments,
month/year/custom-range filtering.

**Transactions** — full CRUD, search, filter by date/amount/category/method/type,
sort, bulk delete, bulk categorise, bulk ML classify, duplicate detection, CSV
import/export, sample CSV download.

**CSV import** — 3-step wizard: delimiter sniffing (`, ; tab |`), UTF-8 BOM,
quoted fields with embedded commas/quotes/newlines, auto column mapping with
manual override, separate debit/credit columns, day-first vs month-first
inference, Tamil/Hindi/Unicode, import preview, and **successful / skipped /
failed counts with a reason for every single row**.

**AI Insights** — dynamically computed findings, each with a "Why this?" panel
showing the exact comparison behind it; dismiss or mark useful; plus the full
classifier report and confusion matrix.

**Expense Forecast** — model comparison table with MAE/RMSE/MAPE, next-month
prediction with an empirical uncertainty range, actual-vs-predicted backtest,
30-day daily forecast with a confidence band, per-category forecast, and
high-expense day analysis.

**Anomaly Detection** — Isolation Forest flags with scores, z-scores, plain-
language reasons, review and "mark as normal" actions, adjustable sensitivity,
and a permanent not-fraud disclaimer.

**Subscriptions** — automatic weekly/monthly/quarterly/yearly detection with
match confidence, next-payment estimates, monthly and annual totals, and
confirm/edit/dismiss that survives re-detection.

**Budgets & Savings** — total and per-category budgets with utilisation, a
pace marker and exceeded/limit alerts; a savings goal tracker; and
recommendations sized from your own category averages, each showing its
supporting months.

**Reports** — 8 report types with CSV, PDF and JSON export, date filters and
professional charts.

**Settings** — currency, date format, theme, savings goal, ML thresholds,
reduced motion, backup/restore, sample data (load / reset / start fresh),
storage usage, live ML runtime check, and a full privacy breakdown.

**Design** — the exact specified palettes, Inter with tabular numerals for all
money, a **separately designed** dark theme (lifted surfaces, lighter accent —
not an inversion), skeleton loaders, empty/error states, confirmation dialogs,
toasts, focus rings, keyboard navigation, 44 px touch targets, and
`prefers-reduced-motion` support. WCAG AA contrast is asserted for every token
pair in both themes by automated test. No gradients, no emoji, no lorem ipsum,
no dead buttons.

---

## 7. Sample dataset

745 transactions over 12 months, fully fictional and deterministic (seed
20250419). Every merchant and employer is invented; no real banking information
appears anywhere. It is deliberately shaped so all four modules have something
genuine to find: 14 categories with varied narrations, Tamil and Hindi merchants,
9 recurring commitments (rent, EMI, 4 subscriptions, 3 utilities), a weekly
delivery, a quarterly insurance premium, a festive-season bump, a rising trend,
and 6 planted high-value outliers. Savings rate: 17.1%.

---

## 8. Privacy

**What happens:** transactions in this browser's IndexedDB; preferences in
localStorage; ML on your own CPU via WebAssembly; CSV files read in-browser;
exports generated locally.

**What never happens:** no bank connection; no passwords, UPI PINs, OTPs or card
details are ever requested; no cloud database; no accounts; no analytics or
trackers; no paid APIs; no LLM calls; no payment processing.

The only network request is the one-time download of the Pyodide runtime and
scikit-learn wheels from the free jsDelivr CDN — **a code download, not a data
upload**. Your transactions have no network path out of the browser.

---

## 9. Cost and compliance

| Item | Status |
| --- | --- |
| Paid APIs / LLMs | **None** |
| Paid hosting / database / storage / auth | **None** - Vercel Hobby is the free tier |
| External resources created | 1 free GitHub repo + 1 Vercel Hobby project (both approved) |
| Accounts upgraded | **None** |
| Billing enabled | **No** |
| Credit card required | **No** |
| Environment variables | **None** (no `.env`, no API keys, no secrets) |
| Installed on your Mac | **Nothing new** — all deps are project-local in `app/node_modules` |

Every dependency is free and open-source. Free-tier notes should you deploy:
Vercel Hobby is non-commercial with a ~100 GB/month bandwidth soft limit;
GitHub Pages allows 1 GB sites and ~100 GB/month. Both are static-only, which is
all this app needs.

---

## 10. Deployment

**Live:** https://finsense-ai-rho.vercel.app
**Repo:** https://github.com/DIVYAPRIYADHARSHINI-GIT/finsense-ai

| Item | Value |
| --- | --- |
| Hosting provider | Vercel |
| Plan | **Hobby (free)** |
| Project name | `finsense-ai` |
| Vercel account | `divyapriyadharshini-git` |
| GitHub account | `DIVYAPRIYADHARSHINI-GIT` |
| Repo visibility | Public |
| Auto-deploy | Connected - every push to `main` deploys to production |
| Billing enabled | **No** |
| Credit card on file | **No** |
| Environment variables | **None** |
| Serverless functions | **None** (pure static output) |

The deployment was verified by `npm run test:live`, which drives the real
production URL in headless Chrome: **29/29 checks passed**, including Pyodide
booting and scikit-learn genuinely training a model in the deployed browser, all
nine routes rendering, deep-link refresh, mobile/tablet layout, and zero console
errors. That suite also asserts the only external hosts the client contacts are
jsDelivr (Pyodide wheels) and Google Fonts - both free CDNs.

To redeploy manually:

```bash
cd "/Users/softage/Designer Projects/starter/finsense-ai/app"
vercel --prod            # or just: git push (auto-deploys)
```

## 11. Known limitations

1. **The forecast currently uses the moving-average baseline.** On 11 months of
   history it genuinely has the lowest backtest MAE. The app states this openly
   rather than presenting a worse model as "AI". More history will change it.
2. **PDF export cannot draw Tamil or Devanagari.** The dependency-free writer
   uses the base-14 Helvetica fonts (WinAnsi), so non-Latin glyphs become `?`
   and a warning toast says so. CSV and JSON exports preserve Unicode perfectly.
   Rendering those scripts would require embedding a licensed font subset.
3. **First ML run downloads ~25 MB** of Pyodide + wheels (~9 s on a warm
   connection), then it is browser-cached. Progress is shown during the wait.
4. **Clearing browser data deletes everything.** That is the direct cost of
   having no server. The app nags you to keep JSON backups.
5. **Classifier accuracy is measured on the sample dataset**, whose narrations
   are synthetic-but-varied. Real bank narrations are messier; expect lower
   real-world accuracy, which is exactly why manual correction and the
   "Uncertain" label exist.
6. **The main JS bundle is 874 kB** (251 kB gzipped), driven mainly by Recharts.
   Acceptable for a dashboard, but route-level code splitting would improve
   first paint.
7. **13 lint warnings remain**, all stylistic (`react-refresh` fast-refresh
   hints on files that export both components and helpers, and one intentional
   form-reset effect). Zero errors.
8. **No accessibility audit library.** Contrast, landmarks, focus, button labels
   and touch targets are asserted by the test suites, but axe-core was not run.

## 12. Differences from the original brief

- **Joblib is not used.** Models are trained in-session rather than persisted as
  `.joblib` files: a browser cannot write to a Python filesystem that survives a
  reload, and retraining takes about a second. Training is explicitly triggered
  and cached in memory, so no work is repeated unnecessarily.
- **Statsmodels is used as a cross-check**, not as the primary forecaster —
  Holt-Winters is displayed next to the selected model for comparison.
- **The ML test suite runs in Node via Pyodide**, not pytest, so that no Python
  packages had to be installed on your Mac. It executes the identical module.

---

Built with React, TypeScript, Tailwind, Recharts, Pyodide and scikit-learn.
100% free and open-source. No paid services. No unexpected charges.
