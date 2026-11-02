"""FinSense AI - real scikit-learn machine learning core.

This exact file is executed in two places:

1. In the browser, inside a Web Worker, by Pyodide (CPython 3 compiled to
   WebAssembly) with the real numpy / pandas / scikit-learn / statsmodels
   wheels. See ``src/ml/worker.ts``.
2. On a developer machine by ``ml/evaluate.py`` in a local virtualenv, which is
   how the published model metrics in the README are produced.

Keeping one file for both means the metrics we report are the metrics the app
actually computes. There is no hardcoded prediction anywhere in this module:
every number returned comes out of a fitted estimator.

Design rules
------------
* Every estimator is seeded (``RANDOM_SEED``) so repeated runs are identical.
* Nothing raises into JavaScript: each entry point returns a dict with an
  ``ok`` flag and a human-readable ``message`` when a job cannot be done
  (usually "not enough data"), because the UI must explain, not invent.
* All entry points take and return plain JSON strings, which is the cheapest
  and most predictable Pyodide <-> JS boundary.
"""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier, RandomForestRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline

RANDOM_SEED = 42

CATEGORIES = [
    "Food & Dining",
    "Shopping",
    "Transportation",
    "Rent",
    "Utilities",
    "Healthcare",
    "Entertainment",
    "Education",
    "Travel",
    "Subscriptions",
    "Groceries",
    "Salary",
    "Investments",
    "Other",
]

# Confidence below this is surfaced to the user as "Uncertain - Review Category".
LOW_CONFIDENCE = 0.55

_STATE: dict = {"classifier": None, "classifier_report": None}


# ---------------------------------------------------------------------------
# text preprocessing
# ---------------------------------------------------------------------------

_NON_WORD = re.compile(r"[^\w\u0b80-\u0bff\u0900-\u097f]+", re.UNICODE)
_LONG_DIGITS = re.compile(r"\d{3,}")
_UPI_HANDLE = re.compile(r"@[a-z]+", re.IGNORECASE)


def preprocess(text: str) -> str:
    """Normalise a bank/UPI narration into classifier input.

    Bank narrations are noisy: ``UPI/DR/402938471/SWIGGY/YESB/swiggy@ybl``.
    We lowercase, drop reference numbers (pure noise, and they would otherwise
    explode the vocabulary), keep the UPI handle word stem, and keep Tamil and
    Devanagari codepoints so Unicode merchant names survive.
    """
    if text is None:
        return ""
    s = str(text).lower()
    s = _UPI_HANDLE.sub(" ", s)
    s = _LONG_DIGITS.sub(" ", s)
    s = _NON_WORD.sub(" ", s)
    tokens = [t for t in s.split() if len(t) > 1 and not t.isdigit()]
    return " ".join(tokens)


def _text_of(rec: dict) -> str:
    return preprocess(f"{rec.get('merchant', '')} {rec.get('description', '')}")


# ---------------------------------------------------------------------------
# ML MODULE 1 - automatic expense classification
# ---------------------------------------------------------------------------


def _candidate_classifiers(n_samples: int, n_classes: int) -> dict:
    """TF-IDF + three classifiers, as specified. Char n-grams help a lot on
    narration text because merchant names get truncated and misspelled."""

    def vec() -> TfidfVectorizer:
        return TfidfVectorizer(
            analyzer="char_wb",
            ngram_range=(3, 5),
            min_df=1,
            sublinear_tf=True,
        )

    def word_vec() -> TfidfVectorizer:
        return TfidfVectorizer(ngram_range=(1, 2), min_df=1, sublinear_tf=True)

    return {
        "Multinomial Naive Bayes": Pipeline(
            [("tfidf", word_vec()), ("clf", MultinomialNB(alpha=0.2))]
        ),
        "Logistic Regression": Pipeline(
            [
                ("tfidf", vec()),
                (
                    "clf",
                    LogisticRegression(
                        max_iter=1500,
                        C=8.0,
                        random_state=RANDOM_SEED,
                        class_weight="balanced",
                    ),
                ),
            ]
        ),
        "Random Forest": Pipeline(
            [
                ("tfidf", word_vec()),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=200,
                        min_samples_leaf=1,
                        random_state=RANDOM_SEED,
                        n_jobs=1,
                    ),
                ),
            ]
        ),
    }


def train_classifier(payload: str) -> str:
    """Train, compare and select the expense classifier.

    payload: {"samples": [{"text"|"merchant"/"description", "category"}], ...}

    Returns the full comparison table, the winning model, holdout accuracy /
    macro-F1 and a confusion matrix. The winner is kept in module state for
    ``predict_categories``.
    """
    data = json.loads(payload)
    samples = data.get("samples", [])

    rows = []
    for s in samples:
        text = s.get("text") or _text_of(s)
        cat = s.get("category")
        if text and cat in CATEGORIES:
            rows.append((text, cat))

    if len(rows) < 30:
        return json.dumps(
            {
                "ok": False,
                "message": (
                    f"Need at least 30 categorised transactions to train a classifier "
                    f"(found {len(rows)}). Import or categorise more transactions, or "
                    f"load the sample dataset."
                ),
                "sampleCount": len(rows),
            }
        )

    df = pd.DataFrame(rows, columns=["text", "category"]).drop_duplicates()

    # Classes with a single example cannot be split or cross-validated; keep
    # them in training but exclude them from the stratified holdout.
    counts = df["category"].value_counts()
    rare = set(counts[counts < 4].index)
    strat_df = df[~df["category"].isin(rare)]
    if strat_df["category"].nunique() < 2:
        return json.dumps(
            {
                "ok": False,
                "message": "Need at least two categories with 4+ examples to train.",
                "sampleCount": int(len(df)),
            }
        )

    x_train, x_test, y_train, y_test = train_test_split(
        strat_df["text"].to_numpy(),
        strat_df["category"].to_numpy(),
        test_size=0.25,
        random_state=RANDOM_SEED,
        stratify=strat_df["category"].to_numpy(),
    )
    if rare:
        extra = df[df["category"].isin(rare)]
        x_train = np.concatenate([x_train, extra["text"].to_numpy()])
        y_train = np.concatenate([y_train, extra["category"].to_numpy()])

    train_counts = Counter(y_train)
    n_splits = max(2, min(5, min(train_counts.values())))

    comparison = []
    best = None
    for name, pipe in _candidate_classifiers(len(x_train), df["category"].nunique()).items():
        try:
            cv_scores = []
            skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_SEED)
            # Cross-validate only on classes that can be stratified n_splits ways.
            ok_classes = {c for c, n in train_counts.items() if n >= n_splits}
            mask = np.array([y in ok_classes for y in y_train])
            cv_x, cv_y = x_train[mask], y_train[mask]
            for tr, va in skf.split(cv_x, cv_y):
                pipe.fit(cv_x[tr], cv_y[tr])
                cv_scores.append(float(accuracy_score(cv_y[va], pipe.predict(cv_x[va]))))

            pipe.fit(x_train, y_train)
            pred = pipe.predict(x_test)
            acc = float(accuracy_score(y_test, pred))
            f1 = float(f1_score(y_test, pred, average="macro", zero_division=0))
            entry = {
                "model": name,
                "cvAccuracy": float(np.mean(cv_scores)) if cv_scores else None,
                "cvStd": float(np.std(cv_scores)) if cv_scores else None,
                "testAccuracy": acc,
                "macroF1": f1,
            }
            comparison.append(entry)
            score = (entry["cvAccuracy"] or 0) * 0.5 + acc * 0.3 + f1 * 0.2
            if best is None or score > best[0]:
                best = (score, name, pipe, pred, acc, f1)
        except Exception as exc:  # pragma: no cover - defensive, surfaced to UI
            comparison.append({"model": name, "error": str(exc)})

    if best is None:
        return json.dumps({"ok": False, "message": "All candidate models failed to fit."})

    _, best_name, best_pipe, best_pred, best_acc, best_f1 = best

    # Refit the winner on everything we have, including the holdout and rare
    # classes, before it is used for real predictions.
    final = _candidate_classifiers(len(df), df["category"].nunique())[best_name]
    final.fit(df["text"].to_numpy(), df["category"].to_numpy())
    _STATE["classifier"] = final

    labels = sorted(set(y_test) | set(best_pred))
    cm = confusion_matrix(y_test, best_pred, labels=labels).tolist()

    report = {
        "ok": True,
        "bestModel": best_name,
        "comparison": sorted(
            comparison, key=lambda r: r.get("testAccuracy") or -1, reverse=True
        ),
        "testAccuracy": best_acc,
        "macroF1": best_f1,
        "trainSize": int(len(x_train)),
        "testSize": int(len(x_test)),
        "totalSamples": int(len(df)),
        "classes": sorted(df["category"].unique().tolist()),
        "confusionMatrix": {"labels": labels, "matrix": cm},
        "lowConfidenceThreshold": LOW_CONFIDENCE,
        "seed": RANDOM_SEED,
    }
    _STATE["classifier_report"] = report
    return json.dumps(report)


def predict_categories(payload: str) -> str:
    """Predict categories + calibrated-ish confidence for unlabelled rows."""
    data = json.loads(payload)
    items = data.get("items", [])
    pipe = _STATE.get("classifier")
    if pipe is None:
        return json.dumps({"ok": False, "message": "Classifier is not trained yet."})
    if not items:
        return json.dumps({"ok": True, "predictions": []})

    texts = [it.get("text") or _text_of(it) for it in items]
    proba = pipe.predict_proba(texts)
    classes = pipe.named_steps["clf"].classes_
    out = []
    for i, item in enumerate(items):
        row = proba[i]
        order = np.argsort(row)[::-1]
        top = int(order[0])
        second = int(order[1]) if len(order) > 1 else top
        conf = float(row[top])
        # An empty narration gives a near-uniform distribution; say so instead
        # of pretending the argmax means something.
        blank = not texts[i].strip()
        out.append(
            {
                "id": item.get("id"),
                "category": str(classes[top]),
                "confidence": 0.0 if blank else conf,
                "uncertain": bool(blank or conf < LOW_CONFIDENCE),
                "runnerUp": str(classes[second]),
                "runnerUpConfidence": float(row[second]),
            }
        )
    return json.dumps({"ok": True, "predictions": out, "threshold": LOW_CONFIDENCE})


# ---------------------------------------------------------------------------
# ML MODULE 2 - expense forecasting
# ---------------------------------------------------------------------------


def _expense_frame(records: list) -> pd.DataFrame:
    rows = [r for r in records if r.get("type") == "expense"]
    if not rows:
        return pd.DataFrame(columns=["date", "amount", "category"])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").abs()
    df = df.dropna(subset=["date", "amount"])
    return df


def _monthly_series(df: pd.DataFrame) -> pd.Series:
    s = df.set_index("date")["amount"].resample("MS").sum()
    return s


def _month_features(month_num: int) -> list:
    """Cyclical month encoding + an explicit festive-season flag.

    A plain month integer would tell a tree that December (12) is 'far' from
    January (1). Sine/cosine keeps the calendar circular. The festive flag
    exists because Indian spending genuinely jumps around Oct/Nov, and without
    it the regressors cannot beat a 3-month moving average.
    """
    angle = 2 * math.pi * (month_num - 1) / 12.0
    return [
        math.sin(angle),
        math.cos(angle),
        1.0 if month_num in (10, 11) else 0.0,
    ]


def _supervised_matrix(values: np.ndarray, lags: int = 3, months: list | None = None):
    """Lag window + momentum + trend + calendar features."""
    x, y = [], []
    for i in range(lags, len(values)):
        window = values[i - lags : i]
        feat = [
            *window,
            float(np.mean(window)),
            float(np.mean(window[-2:])) if lags >= 2 else float(window[-1]),
            float(window[-1] - window[0]),  # recent momentum
            float(i),
        ]
        if months is not None:
            feat.extend(_month_features(months[i]))
        x.append(feat)
        y.append(values[i])
    return np.array(x, dtype=float), np.array(y, dtype=float)


def _next_features(values: np.ndarray, lags: int, next_month_num: int | None):
    """Feature row for the first unobserved month."""
    window = values[-lags:]
    feat = [
        *window,
        float(np.mean(window)),
        float(np.mean(window[-2:])) if lags >= 2 else float(window[-1]),
        float(window[-1] - window[0]),
        float(len(values)),
    ]
    if next_month_num is not None:
        feat.extend(_month_features(next_month_num))
    return np.array([feat], dtype=float)


def forecast_expenses(payload: str) -> str:
    """Forecast next month's spend, per-category spend and the next 30 days.

    Models compared against a moving-average baseline, scored by walk-forward
    backtest MAE/RMSE on the real history. Refuses to answer when history is
    too short rather than drawing a confident line through two points.
    """
    data = json.loads(payload)
    records = data.get("records", [])
    df = _expense_frame(records)

    if df.empty:
        return json.dumps(
            {"ok": False, "message": "No expense transactions yet. Add or import transactions to forecast."}
        )

    monthly = _monthly_series(df)
    # Current month is partial; it would drag every model down.
    today = pd.Timestamp(data.get("today") or date.today().isoformat())
    current_month = today.to_period("M").to_timestamp()
    complete = monthly[monthly.index < current_month]

    MIN_MONTHS = 4
    if len(complete) < MIN_MONTHS:
        return json.dumps(
            {
                "ok": False,
                "needsMoreData": True,
                "monthsAvailable": int(len(complete)),
                "monthsRequired": MIN_MONTHS,
                "message": (
                    f"Forecasting needs at least {MIN_MONTHS} complete months of history; "
                    f"you have {len(complete)}. Keep adding transactions - the forecast "
                    f"unlocks automatically."
                ),
            }
        )

    values = complete.to_numpy(dtype=float)
    history = [
        {"month": ts.strftime("%Y-%m"), "actual": float(v)}
        for ts, v in zip(complete.index, values)
    ]

    # ---- walk-forward backtest ------------------------------------------------
    lags = 3 if len(values) >= 7 else 2
    models = {
        "Moving Average (baseline)": "baseline",
        "Linear Regression": LinearRegression(),
        "Random Forest Regressor": RandomForestRegressor(
            n_estimators=300, random_state=RANDOM_SEED, min_samples_leaf=1, n_jobs=1
        ),
    }

    month_nums = [int(ts.month) for ts in complete.index]

    backtests: dict[str, list] = {name: [] for name in models}
    start = max(lags + 2, len(values) - 6)
    for split in range(start, len(values)):
        train_vals = values[:split]
        train_months = month_nums[:split]
        truth = float(values[split])
        target_month = month_nums[split]
        for name, est in models.items():
            try:
                if est == "baseline":
                    pred = float(np.mean(train_vals[-3:]))
                else:
                    x, y = _supervised_matrix(train_vals, lags, train_months)
                    if len(x) < 2:
                        continue
                    est.fit(x, y)
                    feat = _next_features(train_vals, lags, target_month)
                    pred = float(est.predict(feat)[0])
                backtests[name].append({"month": complete.index[split].strftime("%Y-%m"),
                                        "actual": truth, "predicted": max(0.0, pred)})
            except Exception:
                continue

    metrics = []
    for name, preds in backtests.items():
        if not preds:
            continue
        err = np.array([p["predicted"] - p["actual"] for p in preds], dtype=float)
        metrics.append(
            {
                "model": name,
                "mae": float(np.mean(np.abs(err))),
                "rmse": float(np.sqrt(np.mean(err**2))),
                "mape": float(
                    np.mean([abs(p["predicted"] - p["actual"]) / p["actual"] * 100
                             for p in preds if p["actual"] > 0])
                ),
                "folds": len(preds),
            }
        )
    metrics.sort(key=lambda m: m["mae"])
    best_name = metrics[0]["model"] if metrics else "Moving Average (baseline)"
    baseline_mae = next(
        (m["mae"] for m in metrics if m["model"] == "Moving Average (baseline)"), None
    )

    # ---- fit the winner on all history and predict the next month -------------
    next_ts = complete.index[-1] + pd.offsets.MonthBegin(1)
    next_month_num = int(next_ts.month)
    if best_name == "Moving Average (baseline)":
        next_pred = float(np.mean(values[-3:]))
    else:
        est = models[best_name]
        x, y = _supervised_matrix(values, lags, month_nums)
        est.fit(x, y)
        next_pred = float(est.predict(_next_features(values, lags, next_month_num))[0])
    next_pred = max(0.0, next_pred)

    resid = np.array(
        [p["predicted"] - p["actual"] for p in backtests.get(best_name, [])], dtype=float
    )
    # 1.96 sigma band from backtest residuals - an honest empirical interval.
    sigma = float(np.std(resid)) if resid.size >= 2 else float(np.std(values) * 0.5)
    band = 1.96 * sigma

    # ---- optional statsmodels cross-check -------------------------------------
    stats_pred = None
    try:
        if len(values) >= 6:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing

            hw = ExponentialSmoothing(values, trend="add", seasonal=None,
                                      initialization_method="estimated").fit()
            stats_pred = float(max(0.0, hw.forecast(1)[0]))
    except Exception:
        stats_pred = None

    next_month = (complete.index[-1] + pd.offsets.MonthBegin(1)).strftime("%Y-%m")

    # ---- per-category forecast -------------------------------------------------
    cat_rows = []
    cat_monthly = (
        df.set_index("date").groupby("category")["amount"].resample("MS").sum().reset_index()
    )
    for cat, grp in cat_monthly.groupby("category"):
        g = grp[grp["date"] < current_month].sort_values("date")
        if len(g) < 3:
            continue
        vals = g["amount"].to_numpy(dtype=float)
        recent = float(np.mean(vals[-3:]))
        slope = float(np.polyfit(np.arange(len(vals)), vals, 1)[0]) if len(vals) >= 3 else 0.0
        pred = max(0.0, recent + slope * 0.5)
        cat_rows.append(
            {
                "category": str(cat),
                "predicted": pred,
                "lastMonth": float(vals[-1]),
                "average3m": recent,
                "trendPerMonth": slope,
            }
        )
    cat_rows.sort(key=lambda r: r["predicted"], reverse=True)
    # Scale category parts so they sum to the model's total (keeps the UI consistent).
    cat_total = sum(r["predicted"] for r in cat_rows)
    if cat_total > 0:
        for r in cat_rows:
            r["predicted"] = r["predicted"] / cat_total * next_pred

    # ---- next 30 days ----------------------------------------------------------
    daily = df.set_index("date")["amount"].resample("D").sum()
    dow = defaultdict(list)
    for ts, v in daily.items():
        dow[int(ts.dayofweek)].append(float(v))
    dow_factor = {}
    overall = float(daily.mean()) if len(daily) else 0.0
    for d in range(7):
        vals = dow.get(d, [])
        dow_factor[d] = (float(np.mean(vals)) / overall) if vals and overall > 0 else 1.0
    base_daily = next_pred / 30.0
    horizon = []
    cursor = today
    for i in range(30):
        day = cursor + timedelta(days=i + 1)
        f = dow_factor.get(int(day.dayofweek), 1.0)
        horizon.append(
            {
                "date": day.strftime("%Y-%m-%d"),
                "predicted": float(base_daily * f),
                "lower": float(max(0.0, base_daily * f - band / 30 * 1.0)),
                "upper": float(base_daily * f + band / 30 * 1.0),
            }
        )

    # ---- high-expense periods --------------------------------------------------
    dom = df.copy()
    dom["dom"] = dom["date"].dt.day
    by_dom = dom.groupby("dom")["amount"].sum()
    months_span = max(1, len(complete))
    peaks = [
        {"dayOfMonth": int(d), "averageSpend": float(v / months_span)}
        for d, v in by_dom.sort_values(ascending=False).head(5).items()
    ]

    # ---- expected savings ------------------------------------------------------
    inc = [r for r in records if r.get("type") == "income"]
    income_pred = None
    if inc:
        idf = pd.DataFrame(inc)
        idf["date"] = pd.to_datetime(idf["date"], errors="coerce")
        idf["amount"] = pd.to_numeric(idf["amount"], errors="coerce").abs()
        idf = idf.dropna(subset=["date", "amount"])
        im = idf.set_index("date")["amount"].resample("MS").sum()
        im = im[im.index < current_month]
        if len(im) >= 2:
            income_pred = float(np.mean(im.to_numpy(dtype=float)[-3:]))

    return json.dumps(
        {
            "ok": True,
            "bestModel": best_name,
            "metrics": metrics,
            "baselineMae": baseline_mae,
            "improvementVsBaseline": (
                float((baseline_mae - metrics[0]["mae"]) / baseline_mae * 100)
                if baseline_mae and metrics and baseline_mae > 0
                else None
            ),
            "nextMonth": next_month,
            "nextMonthPrediction": next_pred,
            "lower": float(max(0.0, next_pred - band)),
            "upper": float(next_pred + band),
            "statsmodelsCrossCheck": stats_pred,
            "history": history,
            "backtest": backtests.get(best_name, []),
            "categoryForecast": cat_rows,
            "dailyForecast": horizon,
            "highExpenseDays": peaks,
            "expectedIncome": income_pred,
            "expectedSavings": (income_pred - next_pred) if income_pred is not None else None,
            "monthsUsed": int(len(complete)),
            "seed": RANDOM_SEED,
        }
    )


# ---------------------------------------------------------------------------
# ML MODULE 3 - anomaly detection
# ---------------------------------------------------------------------------


def detect_anomalies(payload: str) -> str:
    """Unsupervised anomaly detection with IsolationForest.

    Features are deliberately interpretable so every flag can be explained:
    log amount, amount z-score inside its own category, day-of-week,
    day-of-month, how rare the merchant is, and the gap since the last charge
    at that merchant. The reasons shown in the UI are derived from those same
    features - we never flag something we cannot explain.
    """
    data = json.loads(payload)
    records = data.get("records", [])
    ignored = set(data.get("ignoredIds", []))
    contamination = float(data.get("contamination", 0.04))

    rows = [
        r
        for r in records
        if r.get("type") == "expense" and r.get("id") not in ignored
    ]
    if len(rows) < 25:
        return json.dumps(
            {
                "ok": False,
                "needsMoreData": True,
                "message": (
                    f"Anomaly detection needs at least 25 expense transactions to learn what "
                    f"normal looks like (found {len(rows)})."
                ),
            }
        )

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").abs()
    df = df.dropna(subset=["date", "amount"]).sort_values("date").reset_index(drop=True)
    if len(df) < 25:
        return json.dumps({"ok": False, "needsMoreData": True,
                           "message": "Not enough valid-dated expense rows for anomaly detection."})

    df["merchant"] = df.get("merchant", pd.Series([""] * len(df))).fillna("")
    df["category"] = df.get("category", pd.Series(["Other"] * len(df))).fillna("Other")

    cat_stats = df.groupby("category")["amount"].agg(["mean", "std", "count"])
    merchant_counts = df["merchant"].str.lower().value_counts()

    feats, meta = [], []
    last_seen: dict[str, pd.Timestamp] = {}
    for _, r in df.iterrows():
        cat = r["category"]
        mean = float(cat_stats.loc[cat, "mean"])
        std = float(cat_stats.loc[cat, "std"]) if not math.isnan(cat_stats.loc[cat, "std"]) else 0.0
        z = (float(r["amount"]) - mean) / std if std > 1e-9 else 0.0
        key = str(r["merchant"]).lower()
        mcount = int(merchant_counts.get(key, 1))
        gap = (r["date"] - last_seen[key]).days if key in last_seen else -1
        last_seen[key] = r["date"]
        feats.append(
            [
                math.log1p(float(r["amount"])),
                z,
                float(r["date"].dayofweek),
                float(r["date"].day),
                math.log1p(mcount),
                float(gap),
            ]
        )
        meta.append({"z": z, "merchantCount": mcount, "categoryMean": mean, "gap": gap})

    x = np.array(feats, dtype=float)
    model = IsolationForest(
        n_estimators=300,
        contamination=contamination,
        random_state=RANDOM_SEED,
        n_jobs=1,
    )
    model.fit(x)
    labels = model.predict(x)
    raw = model.score_samples(x)
    # Map score_samples (more negative = more anomalous) into 0..1 for display.
    lo, hi = float(raw.min()), float(raw.max())
    norm = (hi - raw) / (hi - lo) if hi > lo else np.zeros_like(raw)

    cat_share = df.groupby("category")["amount"].sum()
    anomalies = []
    for i, (_, r) in enumerate(df.iterrows()):
        if labels[i] != -1:
            continue
        m = meta[i]
        reasons = []
        if m["z"] >= 2:
            reasons.append(
                f"{r['amount']:.0f} is {m['z']:.1f} standard deviations above the "
                f"{r['category']} average of {m['categoryMean']:.0f}"
            )
        elif m["z"] <= -2:
            reasons.append(f"Unusually small for {r['category']}")
        if m["merchantCount"] <= 1:
            reasons.append("First and only transaction at this merchant")
        elif m["merchantCount"] <= 2:
            reasons.append(f"Rare merchant - only {m['merchantCount']} transactions on record")
        if m["gap"] >= 0 and m["gap"] <= 1 and m["merchantCount"] > 2:
            reasons.append("Repeated charge at the same merchant within a day")
        if int(r["date"].dayofweek) >= 5 and m["z"] >= 1:
            reasons.append("Large weekend spend compared with your weekday pattern")
        if not reasons:
            reasons.append(
                "Combination of amount, timing and merchant differs from your usual pattern"
            )
        anomalies.append(
            {
                "id": r.get("id"),
                "date": r["date"].strftime("%Y-%m-%d"),
                "merchant": r["merchant"],
                "description": r.get("description", ""),
                "category": r["category"],
                "amount": float(r["amount"]),
                "score": float(norm[i]),
                "zScore": float(m["z"]),
                "reasons": reasons,
            }
        )

    anomalies.sort(key=lambda a: a["score"], reverse=True)
    return json.dumps(
        {
            "ok": True,
            "model": "Isolation Forest",
            "contamination": contamination,
            "analysed": int(len(df)),
            "flagged": len(anomalies),
            "anomalies": anomalies,
            "features": [
                "log(amount)",
                "amount z-score within category",
                "day of week",
                "day of month",
                "log(merchant frequency)",
                "days since last charge at merchant",
            ],
            "disclaimer": (
                "An unusual transaction is not proof of fraud. These are statistical "
                "outliers for you to review."
            ),
            "seed": RANDOM_SEED,
        }
    )


def runtime_info() -> str:
    import sys

    import sklearn

    return json.dumps(
        {
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "sklearn": sklearn.__version__,
            "seed": RANDOM_SEED,
        }
    )
