# ChronoSentry – Changes

Two pieces of work in this update:

- **Data and model work.** Real CSV ingestion, a bundled synthetic sample, chronological training and evaluation in the browser, and a label-leakage guard.
- **Redesign.** A fintech look in the style of a premium card network, with no logos, names or implied affiliation with any real network.

Each section below separates what is measured, estimated and simulated.

---

## 0. What existed before, and what was reused

Inspection findings (before changes):

| Area | Found | Action |
|---|---|---|
| Routing | Navigation was state-based only (`activeTab`). Paths like `/models` did not work. | Kept state-based navigation and added History-API URL sync (`src/routes.ts`, `App.tsx`). |
| CSV parsing | `csvParser.ts` had a parser and a 60/20/20 split. **It derived features from the label when a column was missing.** For example, `distanceKm = labelNum === 1 ? 120 + … : …`. That is direct label leakage. | Rewrote the validator and removed every label-derived value. |
| "Models" | `modelScorer.ts` was a hand-written formula labelled LightGBM, XGBoost, RF and LR. Nothing was trained. | Removed it. Four models are now actually trained in the browser (`models.ts`). |
| Results | `mockData.ts` hard-coded the model metrics, transactions and drift windows. So did the delayed-label horizons (in the component), the queue alert pool, the "94.2 %" stability figure and the "14.6 ms" latency. | Deleted all of them. Every value is now computed from the active dataset and trained models. |
| PII | The `Transaction` type had `cardNumber` and `cardholder`, filled with generated names and masked numbers. | Removed both fields. No column of that kind can reach the UI. |
| Reusable | `costSensitivity.ts`, `probabilityDensity.ts`, `shapDrift.ts`, `queueSimulation.ts`, the palette and dark styling, the sidebar layout and the dashboard section structure. | Kept and extended them, and fixed nullable labels. The random-exploration queue ordering hashed only the first character of the id, so all ids sorted the same; it now hashes the full id. |

---

## 1. CSV upload (requirement 1)

- `DatasetUploaderModal.tsx` was rewritten. It accepts a file by picker or drag-and-drop (accessible label, 60 MB limit, Escape to close, focus management).
- After parsing it shows a full validation report: rows read, valid and skipped, skipped counts by field, the first 8 row errors with row numbers, file-level errors, dropped and excluded columns, feature columns, and a 60/20/20 split preview. **Train on this dataset** activates the file and retrains all models.
- `DatasetManagerView.tsx` (`/dataset`) shows the active dataset, the validation and privacy report, the split cards, a searchable ledger, and an expected-format help panel.

## 2. Bundled synthetic sample (requirement 2)

- `src/data/syntheticSample.ts` is a seeded, deterministic generator (mulberry32 with seed `20250101`):
  - 8,000 transactions over 240 days, about 3 % fraud.
  - Fraud tactics drift over time, from high-value cross-border fraud to low-value card testing.
  - The last 4 days have blank labels, to show Pending/Unknown.
- It produces a CSV in the upload format and goes through the **same** parser, validation, split and training path as an upload.
- It is labelled **"Synthetic sample"** everywhere: page header badge, top-bar dataset pill, KPI badges, row origin badges and the audit export. It can also be downloaded.

## 3. Validation (requirement 3), in `src/utils/csvParser.ts` and `datasetSchema.ts`

- **Required columns (aliases accepted):** `transaction_id`, `timestamp`, `amount`, `merchant_category`, `is_fraud`. A missing column is a file-level error that lists the accepted header names.
- **Timestamps:** ISO-8601, `YYYY-MM-DD HH:MM[:SS]` (read as UTC) or epoch seconds/ms. Impossible dates such as 2025-02-31, bare numbers and years outside 1970–2100 are rejected.
- **Amounts:** must be finite and > 0. `$` and `,` are stripped.
- **Labels:** `0`, `1`, `true` or `false` (case-insensitive). **Blank = unlabelled**: the row is kept and scored, shown as Pending/Unknown, and never used to train or evaluate. Any other value is a row error.
- **Rows skipped with a counted reason:** blank or duplicate id, wrong field count, bad timestamp, bad amount, blank category, bad label.
- **Optional features:** any other column whose values are at least 95 % numeric or boolean. Non-numeric cells are treated as missing and imputed with the training-split median (with a warning). Non-numeric optional columns are ignored and reported.
- **The file is rejected** if there are fewer than 20 valid rows, or if the training split lacks either class.

## 4. Chronological training and evaluation (requirement 4), in `chronoSplit.ts`, `featureSpace.ts`, `models.ts`, `metrics.ts`, `pipeline.ts`

1. Sort by timestamp (stable, ties broken by id), then split into contiguous **60 / 20 / 20** blocks.
2. Fit the feature space on **train only**:
   - log amount, standardised
   - hour of day as sin/cos
   - one-hot merchant category, using the top 12 categories in train plus "other"
   - numeric feature columns, median-imputed and standardised with train statistics
3. Train **4 models on labelled train rows only**, with √ inverse-frequency class weights:
   - **Logistic Regression:** full-batch gradient descent with an L2 penalty.
   - **LightGBM-style:** histogram gradient boosting, 80 rounds, depth 4.
   - **XGBoost-style:** gradient boosting, 100 rounds, depth 3, λ = 2, row subsampling 0.8.
   - **Random Forest:** 60 bagged histogram trees, depth ≤ 7, with per-node feature sampling.
   - These are compact TypeScript re-implementations, **not** the official libraries; the UI says so.
   - If there are more than 30k labelled train rows, legitimate rows are down-sampled and re-weighted.
4. **Threshold tuning on validation only:** the cost-minimising τ* on labelled validation rows. Cost per alert = review cost; cost per missed fraud = amount + penalty. τ* is adopted automatically when a model is trained or selected. Users can override it and re-apply τ* with one click.
5. **Reported metrics come from labelled test rows only:** PR-AUC (average precision), ROC-AUC, precision, recall, F1, MCC, TP/FP/TN/FN, cost, and estimated saving against a no-model baseline. Savings are not clamped, so a model can show a loss. Train and validation views exist but carry a warning that they are optimistic.
6. **Attributions:**
   - Logistic Regression: exact linear SHAP, w·(x − mean).
   - Tree models: path-based (Saabas) attributions, an approximation of TreeSHAP.
   - Attributions are grouped by source column for display.

On the synthetic sample, held-out test PR-AUC is about **0.79** for LightGBM-style, 0.79 XGBoost-style, 0.75 Random Forest and 0.48 Logistic Regression. The test split has 34 frauds in 1,467 labelled rows, so these numbers have wide uncertainty.

## 5. No label leakage (requirement 5), in `src/utils/featureGuard.ts`

- `assertNoLabelLeakage()` throws `LabelLeakageError` if a feature column is:
  - a label (`is_fraud`, `label`, `class`, `target`, …)
  - label-derived (any name containing fraud, chargeback, dispute, label, target or ground_truth)
  - an identifier (`transaction_id`, `*_id`, …)
  - or the dataset's own label or id column, whatever it is called
- The guard is called in the parser, in `fitFeatureSpace` and in `trainPipeline`.
- `toFeatureInput()` passes only `{amount, timestamp, category, features}` to the feature builder, so the label never reaches it. Label-derived CSV columns are dropped and reported.
- **Tests** (`featureGuard.test.ts`):
  - guard positives and negatives
  - `fitFeatureSpace` refuses `is_fraud`
  - flipping every label leaves the feature matrix unchanged
  - **flipping every validation and test label and retraining gives identical predictions for all 4 models**
  - unlabelled rows are excluded from training data

## 6–7. Live Stream (requirements 6 and 7), in `/stream` → `RealtimeStream.tsx` and `TransactionLedger.tsx`

- **Replay test split:** replays the held-out test split in timestamp order and loops at the end.
- **Synthetic stream:** jitters training-split feature profiles and is always badged **Simulated**. Its label is always `null` (Pending/Unknown). Simulated rows are never added to the dataset or used to train, tune or evaluate. The "attack surge" button adds 3 simulated rows built from fraud-like train profiles; their outcome stays unknown.
- **Ledger columns:** Transaction ID and timestamp (UTC), merchant category, amount (USD), fraud probability, predicted status (**Suspicious / Legitimate** at τ, meaning flagged or clear), and actual outcome (**Confirmed Fraud / Confirmed Legitimate / Pending / Unknown**).
- **Ledger tools:** search (id, category, merchant, amount), date range (UTC), risk level, status, category, sortable time/amount/risk columns with `aria-sort`, and pagination.
- The ledger source can be the live buffer, the test split or all rows. Each row has a detail drawer and an **Explain** button that opens the SHAP modal.

## 8. Dashboards wired to computed values (requirement 8)

| View | Source |
|---|---|
| Overview KPIs | Best test PR-AUC (Measured); active-model estimated saving at validation τ* (Estimated); test recall at current τ (Measured); explanation stability from drift Z-tests on confirmed-fraud attributions (Measured) |
| Benchmark | `evaluateModels()` per split. Cost curve on validation (tuning) and test (reported) |
| Drift | `driftWindows.ts`: mean \|attribution\| per window (calendar months, or 12 equal windows if the data spans < 300 days), compared with a train-period baseline by Z-test at 95 % or 99 %. Windows with < 5 rows are never flagged. The two callouts are computed from the data |
| Cost / density / spike charts | Current stream buffer, labelled rows only for costs |
| Delayed labels | `delayedLabels.ts`: test predictions with **simulated** 7/14/30/60-day lags (hash of id, independent of the label); apparent vs. matured metrics |
| Queue | `runDailyQueueSimulation()`: test-split alerts at τ, per UTC day, with capacity from 1 to the busiest day; plus the review workbench (`reviewQueue.ts`, see below) |
| Stream latency | Measured in the browser for the active model |

`mockData.ts` was deleted. Static text such as methodology, literature and research-gap descriptions is kept.

## 9. Visual provenance (requirement 9)

`ui.tsx` adds `ProvenanceBadge` (Simulated, Synthetic sample, Predicted, Confirmed, Measured, Estimated, Historical/Uploaded), `PredictionBadge`, `OutcomeBadge` (dashed "Pending / Unknown") and a `DataLegend`. They are used across the overview, stream, dataset, models, drift, delayed, queue and modal views.

## 10. Privacy (requirement 10)

- Columns are dropped **by header**: card number, PAN, account number, CVV/CVC, names, cardholder, email, phone, address, street, zip, lat/long, city, IP, SSN, passport, DOB, password, PIN.
- Columns are also dropped **by content**: Luhn-valid 13–19 digit numbers, email patterns, phone patterns.
- Dropped columns are never stored on transactions, never displayed, and never echoed in error samples. The user sees a warning listing them.
- A required column whose values look like card numbers or emails (for example, card numbers used as `transaction_id`) rejects the file.
- The demo card is a fixed decorative placeholder (`•••• •••• •••• 4242`) labelled **"DEMO CARD — NO REAL ACCOUNT"**.

## Shared state

`src/state/ChronoContext.tsx` provides one active dataset, one trained bundle, the active model, threshold, costs, analyst status overrides and live stream state to every view. Training runs a tick after load and shows a "Training…" banner (about 0.7 s for the sample under Node).

---

## Redesign

- **Tokens** in `src/index.css`:
  - Tailwind v4 `@theme`: `midnight #0B1220`, `deep #173B70`, `electric #3988FF`, `legit #10B981`, `suspicious #F59E0B`, `fraud #E5484D`.
  - CSS-variable surface tokens for both themes, plus semantic classes (`cs-card`, `cs-inset`, `cs-text`, `cs-muted`, `cs-accent`, `cs-input`, `cs-btn`, `cs-seg`, `cs-th`, `cs-row`).
  - `@custom-variant dark`, so `dark:` is class-based.
  - AA-contrast accent text per theme, visible `:focus-visible` rings and reduced-motion support.
- **Theme** (`src/state/useTheme.ts`, plus an inline script in `index.html` that prevents a flash on load): class-based, persisted in localStorage when available, otherwise follows `prefers-color-scheme` and tracks OS changes until the user chooses. The setting persists across navigation.
- **Branding:**
  - "AI Fraud Intelligence" is the product title, "ChronoSentry" the app name, and the tagline appears in the sidebar, page eyebrows and footer.
  - `document.title` is "Route title · ChronoSentry | AI Fraud Intelligence".
  - The footer reads "Independent research prototype · not affiliated with any card network".
- **Routes** (`src/routes.ts`): `/overview` (Executive Overview), `/stream` (Real-Time Stream and Live Scoring), `/manual` (Manual Transaction), `/models` (Model Benchmarking and Cost-Sensitive Tuning), `/shap` (SHAP Explanations and Local Attribution), `/drift` (Confidence-Bounded Drift Monitoring), `/delayed` (Delayed-Label Evaluation), `/queue` (Limited Review Queue Simulator), `/methodology` (Methodology and Limitations), `/about` (Technical Details). *Titles of the last two updated in the Delayed/Queue/Reference change below.*
  - Extras: `/dataset`; `/transactions` is an alias for `/stream`; `/` and unknown paths go to `/overview`.
  - Sidebar items are real links (`href`) with `aria-current`. Back and forward work.
- **Sidebar:**
  - Responsive. On mobile it is an off-canvas drawer opened by a toggle with `aria-controls` and `aria-expanded`. It closes with Escape or a backdrop click, and focus moves to the close button.
  - Shows stream status, flagged count and a theme toggle (`aria-pressed`).
  - There is a skip-to-content link.
- **Overview:** KPI tiles with provenance badges; the virtual demo card (generic chip, contactless and two-ring shapes, no network logos); a spend summary from the last 30 days of data; live stream status and processed count; high-priority alerts ranked by expected loss; a weekly fraud trend chart (confirmed vs. flagged, with validation and test start markers); recent activity with lucide merchant icons; research contribution cards linking to the detail routes.
- **All pages** were moved to the shared card, typography and spacing system. The previously dark-only charts (`FraudSpikeChart`, `ErrorCostBreakdown`, `ProbabilityDensityPlot`, `TransactionShapModal`) and the off-palette teal dataset views now work in light and dark themes.
- **Dialogs** have `role="dialog"`, `aria-modal`, Escape to close and initial focus. Tables have captions and `scope`. Charts have `role="img"` with labels.
- `Header.tsx` was removed: it was unused, and it was the only user of the analyst avatar image.

---

## Manual Transaction (`/manual`)

A sidebar page, **Manual Transaction**, that scores one hand-entered transaction with the active trained model. Document title: "Manual Transaction · ChronoSentry | AI Fraud Intelligence".

**Inputs come from the real feature space, not a guess.** The model's inputs (`featureSpace.ts`) are: log amount (standardised), hour of day (UTC, sin/cos), one-hot merchant category (top 12 train categories plus "other") and the dataset's optional numeric columns (train-median imputed, standardised). Day-of-week is *not* a model input, so it is not derived. The form is built by `buildManualFormSpec()` from `bundle.featureSpace.numericColumns` and the train split:

| Field | Source | Validation |
|---|---|---|
| Amount (USD) | always | required, plain number, > 0, ≤ 10,000,000; warning above the largest training amount |
| Date and time (UTC) | always (`datetime-local`) | required, valid calendar date, 1970–2100 (same `parseTimestamp` as CSV ingestion). Only the hour reaches the model |
| Merchant category | train-split categories, most frequent first | must be a known category; rare ones are marked "scored as other" |
| One field per numeric model column | e.g. on the sample: `distance_km`, `velocity_1h`, `device_score`, `is_online`, `foreign_country` | required; 0/1 columns become Yes/No selects; integer columns must be whole numbers; columns never negative in train reject negatives; values outside the train range are allowed with a warning |

Defaults are train-split medians. No card number, CVV, name, e-mail or password field exists. An uploaded CSV with different columns gets a different form automatically.

**Check Transaction** → `checkManualTransaction()` in `src/utils/manualTransaction.ts`: validate → `featureSpace.transform` (same train-fitted preprocessing and column order) → `bundle.models[activeModel].predict` → `explainRow` (the existing SHAP/Saabas attribution utility) at the current threshold (the validation-tuned τ* unless the user overrode it; the page says which). The result shows Suspicious/Legitimate (Fraud/Not fraud at τ), the **uncalibrated** model score, warnings, the submitted details, the attributions, the derived encoded inputs and an "Open in investigation modal" button. With no trained model the page and the function return a clear "No trained model is loaded" message; nothing is faked or randomised. Values stay in the form on error (fields get `aria-invalid` and messages); the form resets to defaults only after a successful check.

**Stream isolation.** Manual rows live in their own `manualRaw` / `manualTransactions` slice in `ChronoContext`. Submitting never touches `streamBuffer`, `processedCount`, the replay index, `streamRunning` or the interval, so the stream keeps running (or stays paused) exactly as before. The interval's replay/buffer steps were moved into two pure helpers in `syntheticStream.ts` (`nextReplayRow`, `pushToStreamBuffer`) with identical behaviour, so the isolation can be unit-tested.

**Data model.** `DataOrigin` gains `'manual_entry'`; `Transaction` gains an optional `source: 'manual' | 'simulated' | 'dataset_replay'` (`transactionSource()` derives it for older rows). Manual rows have `groundTruthLabel: null`, no `split`, and are badged **Manual test** (`ProvenanceBadge kind="manual"`, `OriginBadge`). They are never added to the dataset, so training, threshold tuning, metrics, drift, delayed-label and queue views cannot see them; no retraining happens. They appear in the page's history table and in a separate **Manual tests** tab of the stream ledger (not in the live buffer or its KPIs/charts), are re-scored when the active model or threshold changes, are capped at 50, and are cleared when a new dataset is loaded (its feature space differs). The audit export reports only their count.

**Files.** New: `src/utils/manualTransaction.ts`, `src/utils/manualTransaction.test.ts`, `src/components/ManualTransactionView.tsx`. Changed: `src/types/fraud.ts`, `src/utils/syntheticStream.ts`, `src/state/ChronoContext.tsx`, `src/routes.ts`, `src/components/Sidebar.tsx`, `src/components/ui.tsx`, `src/components/RealtimeStream.tsx`, `src/App.tsx`.

**Tests** (`manualTransaction.test.ts`, 9 tests, real training run on the sample): form spec equals the fitted feature space and has no sensitive fields; for all 4 models the manual path equals calling `predict(transform(input))` directly and `explainRow`; UTC timestamp handling; invalid input gives per-field messages; missing model gives a clear error with no score; submissions with the stream stopped leave the stream state identical; submissions interleaved with 150 replay ticks and 40 synthetic ticks leave the buffer, index and processed count identical to a run without them, with no duplicates and no manual rows in the buffer; the manual list is immutable, newest first, capped, de-duplicated; manual/simulated/dataset rows are distinguishable and a manual row mixed into the data changes neither training rows nor test metrics nor τ*.

**QA for this change.** `npm run lint` pass (0 errors); `npm run build` pass (same > 500 kB chunk warning, 880 kB / 250 kB gzipped); `npm test` **43 / 43 pass** (34 existing + 9 new). jsdom smoke test on the single-file preview at `/manual`: correct h1, title and active nav item; 8 fields matching the sample's feature space; invalid amount kept with an inline message; a valid check rendered a verdict, uncalibrated score, details and attributions and reset the form; the stream's processed count kept rising while running, stayed frozen while paused (a check while paused still worked), and resumed; the stream ledger's "Manual tests (2)" tab listed both rows with the badge and the live buffer contained none. Not checked in a real browser.

**Limitations.** One transaction at a time. Scores are uncalibrated and extrapolate outside the training range (a warning is shown). Manual history is in memory only (lost on reload) and cleared on dataset change. The analyst "Mark fraud / Clear" buttons work on manual rows as a UI status only; they never become labels.

---

## Delayed-label drill-down, review workbench, Methodology/About cleanup, sidebar groups

**What the delayed-label bars mean (determined from `delayedLabels.ts` and `csvParser.simulatedLabelLagDays`).** Each labelled held-out test row has a simulated dispute lag of exactly 7, 14, 30 or 60 days (FNV hash of the id: ≈30 / 35 / 25 / 10 %, independent of the label). A bar "Day H" is a **cumulative horizon over the same cohort**, not a separate time window: it shows how many of *all* labelled test rows have a label available H days after their own timestamp (lag ≤ H) and how many are still pending. So the label-available sets are nested (Day 7 ⊂ Day 14 ⊂ Day 30 ⊂ Day 60) and at Day 60 nothing is pending. Unlabelled test rows (blank label in the data, e.g. the sample's last 4 days) are excluded because their label never arrives.

**`/delayed`**
- `selectDelayedPeriod()` / `filterDelayedRows()` (new, in `delayedLabels.ts`) return the actual rows behind one bar: id, timestamp, amount, category, score, predicted status at τ, simulated lag, label status at H (available / pending) and a "newly matured" flag (lag in (previous horizon, H]); counts (total, available, confirmed fraud/legit, pending, pending frauds, newly matured, flagged); the cohort date range; and the **same** `DelayHorizon` object `computeDelayHorizons()` produces for the chart (now also carrying apparent TP/FP/FN and `total`).
- All four bars (7, 14, 30, 60) are clickable (recharts `Bar onClick` on every stacked series, `Cell` per horizon: selected = full opacity + blue outline, others dimmed). The horizon cards below the chart are `aria-pressed` buttons mirroring the bars for keyboard use (the redundant segmented control was removed). The tooltip is built from the same `DelayHorizon` object, so tooltip, cards and detail panel agree.
- New `DelayedPeriodDetail.tsx`: explanation of cumulative horizons, counts, apparent PR-AUC / precision / recall / TP-FP-FN, filters (All / Label available / Still pending / Newly matured) and a 25-row paginated table with the total count. Empty cohort and empty filter states; training state handled by the page.

**`/queue`** (existing capacity simulation kept unchanged)
- Purpose text and a **Simulation / demo** badge at the top.
- New `ReviewWorkbench.tsx` + pure `src/utils/reviewQueue.ts`: the queue is every test-split row the active model flags at the current τ, ordered by expected loss (score × amount), with amount, time, risk score, dataset ground truth (separate column, `OutcomeBadge`) and flag reasons = top 3 positive attributions from the existing `explainRow()` output (`shapBreakdown`).
- State machine: `pending → reviewed | confirmed_fraud_sim | legitimate_sim`; every decision is terminal. A second decision is rejected (`already_decided`), ids not in the current queue are rejected (`unknown_item`), undo is allowed only for the most recent decision while that alert is still in the state it produced (`undo_not_clean` otherwise). Reset clears all. Counts are computed over the current queue only (`countReviewQueue`), so they stay consistent when τ or the model changes.
- Decisions live in a separate `reviewState` slice of `ChronoContext` (kept across navigation, cleared when a dataset loads; a ref guards against double-click duplicates). They are never written to `groundTruthLabel` and never reach training, threshold tuning, metrics, drift or the stream. The agreement line (simulated verdict vs. ground truth) is display-only.

**`/methodology`** rewritten as 7 sections: Data source & synthetic status; Features & leakage guard; Models & training; Time-aware split & evaluation; Metrics; Delayed labels & drift; Assumptions, limitations & weaknesses. Text restates only what this file and the source code establish; counts, split sizes/dates, τ/τ*, costs, training rows/time, feature counts and the active model's test metrics are read live from the context. The previous literature list (one "2026 preprint" and three titles without authors or links) was **removed** from both Methodology and About because it could not be verified from the repository.

**`/about`** is now "Technical Details": architecture (module map), models, stack, local setup commands. The duplicated tech-stack / expected-output / reference cards were removed.

**Sidebar** (`routes.ts` `NAV_GROUPS`, `Sidebar.tsx`): Home (Overview) · Transaction testing (Real-Time Stream, Manual Transaction) · Dataset · Detection (Model Benchmarking, SHAP) · Evaluation (Drift, Delayed-Label) · Review (Review Queue Simulator) · and a smaller secondary **Reference** group (Methodology & Limitations, Technical Details). All routes and aliases unchanged.

**Files.** New: `src/utils/reviewQueue.ts`, `src/utils/reviewQueue.test.ts`, `src/utils/delayedLabels.test.ts`, `src/utils/navigation.test.ts`, `src/components/DelayedPeriodDetail.tsx`, `src/components/ReviewWorkbench.tsx`. Changed: `src/utils/delayedLabels.ts`, `src/components/DelayedLabelQueueSimulator.tsx`, `src/components/ResearchMethodology.tsx`, `src/components/AboutView.tsx`, `src/components/Sidebar.tsx`, `src/routes.ts`, `src/state/ChronoContext.tsx`, `src/App.tsx` (audit export lists reviewer decisions as simulated), `CHANGES.md`. No dependencies added.

**Tests (13 new, real training run on the sample).** `delayedLabels.test.ts`: all of 7/14/30/60 select the same 1,467-row labelled test cohort in time order with the right date range and the excluded unlabelled count; per-row availability = lag ≤ H; available sets strictly nested and growing (on the sample 437 → 952 → 1,321 → 1,467; availability does not depend on τ), Day 60 has 0 pending; newly-matured sets are disjoint and partition the cohort; counts and metrics equal the chart's `computeDelayHorizons()` values for every bar; empty input / only-unlabelled / too-early horizon handled. `reviewQueue.test.ts`: queue = flagged test rows ordered by expected loss with positive SHAP reasons; valid transitions and counts; duplicate / unknown rejected without state change; undo rules; decisions never change labels or `evaluateModels()` output; counts after τ changes. `navigation.test.ts`: every route in exactly one group, Reference last and secondary, all paths still resolve.

**QA for this change.** `npm run lint` pass (0 errors). `npm run build` pass (same > 500 kB warning; 898 kB / 257 kB gzipped). `npm test` **56 / 56 pass** (43 existing + 13 new). jsdom smoke on the single-file preview: `/delayed` selecting Day 7 / 14 / 30 / 60 shows distinct panels (available 437 / 952 / 1,321 / 1,467, pending 1,030 / 515 / 146 / 0, newly matured 437 / 515 / 369 / 146, 25-row page of 1,467), `aria-pressed` follows the selection and the pending filter shows only pending rows; `/queue` shows the demo badge, 62 alerts at the tuned τ, Confirm fraud moves one alert to Decided with its buttons disabled and ground truth still shown, Undo restores the counts, further decisions persist across navigation; `/methodology` has the 7 sections, `/about` the 4 cards and title "Technical Details · ChronoSentry | AI Fraud Intelligence"; the original `/manual` smoke (stream keeps running / pauses / resumes, manual rows not in the live buffer) still passes. jsdom does not lay out recharts series inside `ResponsiveContainer`, so in the app smoke the selection was driven through the mirrored buttons; the bar `onClick` + `Cell` wiring was verified separately with a fixed-size recharts `BarChart` in jsdom (click on the third bar → index 2 → Day 30, highlight moved). Not checked in a real browser.

**Limitations.** Horizons are cumulative over one cohort, so the bar tables necessarily overlap; "Newly matured" is the disjoint view. Lags are simulated. Reviewer decisions are in memory only and are lost on reload. The review queue uses the test split only (not the live stream buffer).

---

## Functional audit and bug fixes (in place)

Every interactive control on every route was exercised in a **real headless Chromium 141** (Playwright 1.56 headless shell, run against `vite preview` of the production build). A browser download that was blocked earlier worked this time; four missing system libraries were extracted from Debian packages into a local folder, no system changes. 151 browser checks pass, plus the unit tests. Nothing was redesigned, no feature was removed, no dependency was added and no evaluation math was changed.

### Bugs found and fixed

| # | Page / component | Bug | Fix |
|---|---|---|---|
| 1 | All dialogs (upload, SHAP investigation, detail drawer) | Their focus/Escape effect depended on an inline `onClose`, so **every live-stream tick (3.2 s) re-ran it and pulled focus back to the close button**. Keyboard users could not stay on "Choose CSV file" or "Mark fraud". Confirmed in the browser before the fix. | New `src/state/useDialog.ts`: initial focus once per open, Escape via a ref, Tab/Shift+Tab trapped in the dialog, focus returned to the opener, background scroll locked. Used by the upload modal, SHAP modal, detail drawer and mobile sidebar drawer. |
| 2 | SHAP modal, upload modal | `flex items-center` plus `overflow-y-auto`: when the dialog was taller than the window, **its top (title and close button) overflowed upward and could not be scrolled to**. | Auto-margin centring (`m-auto`): centred when it fits, top-aligned and fully scrollable when it does not. |
| 3 | Live stream (ChronoContext) | `splits.test` gets a new identity on every τ or analyst-status change and was a dependency of the interval effect, so **moving the threshold slider restarted the 3.2 s timer and the stream stalled**. | The interval reads rows, templates and scorer through a ref and depends only on running/speed/mode/model bundle. Verified: τ moved every 0.8 s for 7.2 s and the replay kept advancing. |
| 4 | Transaction ledger (stream, dataset) | Page index reset whenever `transactions.length` changed, so **on the live buffer you were bounced back to page 1 on every tick**. A source switch could also leave an out-of-range page. | Reset on filter, sort or source change (`resetKey`) only; the page is clamped. |
| 5 | Transaction ledger | A category filter chosen on one source stayed active after switching to a source without that category, but **the dropdown showed "All categories"**, hiding the filter. | The selected category stays listed while it is active. |
| 6 | Delayed-label chart | Clicking thin stacked segments (for example 11 confirmed frauds, 1–2 px tall) was unreliable. *During this audit* a chart-level click handler was tried and the browser test showed it **selected the previously hovered column** (recharts hover state lags one click). That handler was removed before release. | A transparent full-height `background` on the first series makes the whole column clickable. The index comes from the clicked element. Verified for 7/14/30/60 by clicking columns and the 1 px fraud segment; the detail panel shows 437 / 952 / 1,321 / 1,467 available labels. |
| 7 | Review workbench | In the "Awaiting" view a decided row disappeared at once, so **a double-click's second click landed on the next alert and decided it too**. | Rows decided in the current view stay in place with disabled buttons until the view changes or Reset is pressed. The status line's reserved height was also fixed (`min-h-4`) so the table no longer shifts by 4 px when a message appears. |
| 8 | Manual Transaction | Typed values and the last verdict were component state, **lost when navigating away and back**. Also, after a model or τ change the old verdict was shown without saying so. | Draft and last result live in ChronoContext (cleared when a dataset loads). The result card notes when it was computed with a different model or τ than the active one; the history table shows the re-score. |
| 9 | View selections | Delayed horizon, analytics tab, ledger source, dataset split, model cohort, drift feature/population/confidence, SHAP selection, queue view/strategy/capacity **reset on every navigation**. | Small in-memory `useSessionState` (`src/state/useSessionState.ts`): kept across navigation, not across reload, never used for data. SHAP falls back to a sample case when the remembered id is not in a newly loaded dataset. |
| 10 | SHAP search | An empty query matched the first dataset row. A miss did nothing, with no feedback. | Empty query → prompt. Miss → "No transaction in the active dataset matches …". Hit → "Showing …" (live region). |
| 11 | Stream cost panel | "Net Value Saved" always printed `+$` in green, so a loss read as `+$-123.00`. | Sign and colour follow the value (display only; the number is unchanged). |
| 12 | Stream cost panel vs Models page | The same shared cost settings had different slider ranges (C_FP step 5 from 5 vs. step 1 from 1; penalty step 10 vs 5). A value set on one page showed a snapped thumb on the other. | Both use C_FP 1–100 step 1 and penalty 0–200 step 5. |
| 13 | Model Benchmarking | The τ slider only moved a reference line, so **no metric visibly responded to it** (the table is at τ\* by design). | Added one line with the active model's precision, recall, F1, TP/FP/FN and cost **at the current τ** on the selected cohort, from the existing `computeBinaryMetrics`. |
| 14 | Audit JSON export | The anchor was clicked while detached and the blob URL was revoked synchronously, which some browsers (Firefox) treat as a cancelled download. Same for the sample CSV download. | Anchor attached before the click; URL revoked after 1 s. Verified downloads from the header, Methodology and Technical Details (valid JSON, 4 models). |
| 15 | Upload | Re-picking the same file after editing it did not fire `change`. A CSV dropped outside the drop zone made the browser open the file, **discarding models, manual tests and review decisions**. The validation report stayed after "Train on this dataset", so reopening offered to train it again. The hidden file input had no visible focus ring. | Input value reset after each pick. File drops are default-prevented on the dialog and window (asserted with `defaultPrevented`). The report clears after Train or "Use synthetic sample" but stays on a plain close. The label gets a `peer-focus-visible` ring. |
| 16 | Overview | Research-contribution links used ``href={`/${id}`}`` and blocked Ctrl/Cmd-click. | `ROUTES[id].path`; modifier clicks open a new tab (same for the sidebar brand link). |
| 17 | Dataset page | "Load synthetic sample" while the sample is active silently retrained and cleared manual tests and decisions. | Labelled "Reload synthetic sample", with a tooltip that says what is cleared. |
| 18 | Review table, stream ledger | At 1366 px both tables overflowed (actions clipped) after the font-size increase. | Time column may wrap; review actions stack vertically; ledger actions wrap. Measured: no table overflows at 1366 px. |
| 19 | Drift trajectory | A fixed 720×200 viewBox with `preserveAspectRatio="none"` stretched the labels and **shrank them below 12 px on phones**. | Laid out in real pixels via `ResizeObserver`; window labels thin out so they never overlap. |
| 20 | Buttons | Several buttons had no `type`. Only the two in the Manual form could submit, and those were already typed correctly. | Every `<button>` now has an explicit `type`. Icon-only buttons got `aria-hidden` icons; review and model buttons got row-specific `aria-label`s. |

**Checked and not a bug.** The "Expected CSV format" example looked corrupted ("Sat 2025-03-01 2:45 PM IST") in this sandbox's tool output. The file bytes are valid ISO-8601; the display layer rewrote them. The example now comes from `EXAMPLE_CSV` in `datasetSchema.ts`, with an added unlabelled row, and a unit test asserts that it parses (3 valid rows, 1 unlabelled, 2 feature columns).

### Accessibility fixes (flagged by the earlier automated check)
- **Text ≥ 12 px:** all `text-[9px]`, `text-[10px]` and `text-[11px]` became `text-xs`. Chart ticks, legends and reference labels are 12 px. Verified in the browser on 9 routes at 390 px: no visible text below 12 px.
- **Touch targets:** at ≤ 767 px or with a coarse pointer, every button, nav link, select and input is at least 44 px tall, and icon-only buttons are 44 px wide. Verified on 9 mobile routes. Off-canvas sidebar links are `invisible` (out of the tab order) while the drawer is closed.
- **Filled buttons:** white on `#3988FF` was 3.4:1. Primary buttons and pressed segmented buttons now use `#1D5BD8`, a deeper shade of the same blue (5.9:1; hover `#1A4FBF`). `#3988FF` is kept for icons, charts, borders and focus rings.
- **Chart legends:** the blue (`#3988FF`, 3.4:1) and purple (`#A78BFA`, 2.7:1) legend labels now use the muted text colour; swatches keep the series colour. The test-cost line is `#8B5CF6` (≥ 3:1 graphic contrast in both themes). Axis ticks and reference-line labels (τ, τ\*, validation/test markers, spike threshold) use theme-aware AA colours via CSS (`.cs-svg-*`). Measured on `/models`: 15 colour pairs ≥ 4.5:1 in light and dark.
- **Breadcrumb:** the page title still truncates with an ellipsis but carries `title` with the full name; the app name and chevron no longer shrink.

### Verification
- `npm run lint`: pass, 0 errors.
- `npm run build`: pass (same > 500 kB chunk warning; 905 kB / 259 kB gzipped).
- `npm test`: **57 / 57 pass** (56 existing + 1 new in `csvParser.test.ts` for the documented CSV example).
- **Real browser:** `qa/browser/audit.mjs` (124 checks) and `qa/browser/mobile.mjs` (27 checks), all passing, with **zero console errors or warnings, zero failed requests and zero HTTP ≥ 400** across all runs. They cover:
  - every sidebar item, Back/Forward, direct URLs, aliases, the theme across navigation and reload, and the skip link;
  - stream start, pause, resume, speed, τ, τ\*, analytics tabs, ledger sources, filters, sort, pagination, drawer, modal, synthetic stream and surge;
  - Manual Transaction validation, Enter submit, Reset, persistence, and stream before/during/after checks (running and paused);
  - delayed-label column clicks for 7/14/30/60, the thin segment, cards via keyboard, filters, pagination and persistence;
  - review-queue actions, double-click, Undo, Reset, views, pagination and capacity/strategy;
  - Models: model select, cohorts, τ, τ\*, cost sliders;
  - SHAP samples and search; drift feature, confidence, population and persistence;
  - three audit-JSON downloads;
  - Dataset: sample download, split cards, upload modal open/close (button, Escape, backdrop, header pill), focus return, non-CSV rejection, a 303-row CSV with sensitive and label-derived columns (300 valid, 3 skipped, 9 unlabelled, no card number or email ever in the DOM), Train, drag & drop, and Use synthetic sample;
  - mobile drawer, 44 px targets, 12 px text, contrast and light/dark screenshots.
- Screenshots were reviewed by eye (light and dark, desktop and 390 px mobile).

### Still needs a human
- Real touch-device feel (momentum scroll, on-screen keyboard over the Manual form) and screen-reader announcement wording. The ARIA wiring is in place, but no assistive technology was run.
- Real OS-level drag-and-drop from a file manager. Drops were simulated with `DataTransfer`; native drops use the same handlers.
- Browsers other than Chromium (Firefox and Safari download behaviour is handled by the export fix but was not run).

**Files.** New: `src/state/useDialog.ts`, `src/state/useSessionState.ts`, `src/components/chartTheme.tsx`, `qa/browser/{audit.mjs,mobile.mjs,common.mjs,README.md}`. Changed: `src/App.tsx`, `src/index.css`, `src/state/ChronoContext.tsx`, `src/utils/datasetSchema.ts`, `src/utils/csvParser.test.ts`, and the components `AboutView`, `DatasetManagerView`, `DatasetUploaderModal`, `DelayedLabelQueueSimulator`, `DelayedPeriodDetail`, `ErrorCostBreakdown`, `FraudSpikeChart`, `HomeOverview`, `ManualTransactionView`, `ModelBenchmark`, `ProbabilityDensityPlot`, `RealtimeStream`, `ResearchMethodology`, `ReviewWorkbench`, `ShapDriftMonitor`, `ShapExplainerView`, `Sidebar`, `TopHeader`, `TransactionDetailDrawer`, `TransactionLedger`, `TransactionShapModal`, `VirtualCard` and `ui` (font-size and `type` attributes only for the last ones). `CHANGES.md`.

---

## Expected CSV format

| Column | Required | Rules |
|---|---|---|
| `transaction_id` (aliases `id`, `txn_id`, `trans_num`) | yes | non-blank, unique, anonymous (no card numbers) |
| `timestamp` (aliases `trans_date_trans_time`, `datetime`, `date`, `time`) | yes | ISO-8601, `YYYY-MM-DD HH:MM[:SS]` (UTC) or epoch seconds/ms |
| `amount` (aliases `amt`, `transaction_amount`) | yes | number > 0 (`$` and `,` allowed) |
| `merchant_category` (alias `category`) | yes | non-blank text |
| `is_fraud` (aliases `fraud`, `label`, `class`, `target`) | yes (column) | `0`, `1`, `true`, `false`; blank = unlabelled |
| `merchant` / `merchant_name` | optional | display only, never a feature |
| any other numeric column (e.g. `distance_km`, `velocity_1h`, `device_score`, `is_online`) | optional | model features (booleans become 0/1) |
| card number / CVV / name / email / phone / address / credential columns | **never** | dropped automatically with a warning |

Example:

```csv
transaction_id,timestamp,amount,merchant_category,is_fraud,distance_km,velocity_1h
TX-0001,2025-03-01T09:15:00Z,42.50,Grocery,0,3.2,1
TX-0002,2025-03-01T09:17:30Z,1899.00,Electronics,1,412.8,5
TX-0003,2025-03-01T09:21:05Z,18.75,Restaurant,,6.1,1
```

---

## QA results

These were the actual results at the time of writing.

| Check | Result |
|---|---|
| `npm install` | Works. The `esbuild` devDependency was bumped from ^0.25 to ^0.27 to resolve a Vite 8 peer conflict. `react-is` (a recharts peer that was already in `bun.lock`) is now declared explicitly so the npm build resolves it. |
| `npm run lint` (`tsc --noEmit`) | pass, 0 errors |
| `npm run build` (`vite build`) | pass. Only a warning that the bundle is larger than 500 kB (about 856 kB, 245 kB gzipped). |
| `npm test` (`node --test src/utils/*.test.ts`) | **34 / 34 pass** (43 / 43 after the Manual Transaction change; 56 / 56 after the delayed-label / review-queue change; 57 / 57 after the functional audit) |
| `vite preview`: HTTP 200 on `/`, all 9 required routes, `/dataset` and `/transactions` | pass |
| DOM smoke test (jsdom 24 + an esbuild IIFE bundle, script outside the repo) | Every route renders the correct h1 and document title with branding and no console errors. Also checked: sidebar navigation updates the URL; back works; the theme toggle persists across navigation and to localStorage; light theme follows the system setting; the ledger has the required headers; Explain opens the SHAP modal; the Unknown filter shows unlabelled rows; synthetic stream and surge produce "Simulated / Pending / Unknown" rows; an upload with `cc_num` and `email` columns, 3 bad rows and 9 blank labels was handled correctly (300 valid, 3 skipped by field, sensitive columns dropped and never present in the DOM, label-derived `fraud_score` excluded, retraining done, dataset badge "Uploaded"). |
| Real-browser visual check | Not done at first: Chromium downloads were blocked (HTTP 403). **Done in the functional audit**: headless Chromium 141, 151 interaction checks, screenshots reviewed (see "Functional audit and bug fixes"). |

## Known limitations

- The models are compact in-browser re-implementations. They are not tuned, and their probabilities are not calibrated: class weighting inflates them, which is why thresholds are tuned on validation.
- Tree attributions are Saabas path attributions, an approximation of TreeSHAP, not exact Shapley values.
- Training runs on the main thread. Very large uploads (hundreds of thousands of rows) will freeze the UI for a few seconds. Training data is capped at 30k rows with down-sampling. A Web Worker would fix this.
- The delayed-label lags and the queue capacity are simulations. The cost savings are estimates driven by the user's cost settings.
- The drift tests apply no multiple-comparison correction. The UI says so.
- The test split of the synthetic sample has only about 34 frauds, so metrics carry wide uncertainty.
- The analyst status buttons (Mark fraud / Clear) and the review-queue decisions are a UI workflow only. They do not change labels or retrain.
- View selections, the Manual draft and the last Manual result persist across navigation in memory only. They are lost on reload.
