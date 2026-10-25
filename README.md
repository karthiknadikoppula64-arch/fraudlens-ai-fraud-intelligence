# ChronoSentry

> See **CHANGES.md** for the latest data pipeline (CSV validation, chronological training, label-leakage guard) and redesign notes, including the expected CSV format.

**Time-Aware, Cost-Sensitive Credit Card Fraud Detection with Explanation Drift Monitoring, Delayed-Label Evaluation & Review Capacity Simulation**

An academic research prototype and interactive operations dashboard built to evaluate machine learning fraud detection systems under realistic banking constraints. Inspired by the methodology of the 2026 dollar-metric fraud study.

---

## 🎯 Executive Summary

Standard academic fraud detection benchmarks evaluate models using random cross-validation splits, assume instantaneous ground-truth label feedback, report SHAP drift without uncertainty intervals, and assume unlimited human investigation bandwidth. 

**ChronoSentry** addresses these four critical gaps:
1. **Strict Chronological Partitioning**: Evaluates models on contiguous, non-shuffled time periods (first 60% of rows by time = train, next 20% = validation, final 20% = held-out test) to prevent look-ahead bias and capture natural concept drift.
2. **Confidence-Bounded SHAP Explanation Drift**: Introduces statistical standard-error and bootstrap 95% confidence bands (two-sided Z-test against baseline) to monitor feature importance over time, successfully suppressing false alarms in low-volume months.
3. **Delayed-Label Evaluation Protocol**: Explicitly models 7, 14, 30, and 60-day customer chargeback lags. Isolates latent unconfirmed transactions to prevent false-negative estimation bias.
4. **Limited Human-Review Queue Simulator**: Simulates fixed investigator capacity (e.g., 50 reviews/day) and compares four alert ranking strategies (*Highest Expected Dollar Loss*, *Cost-Utility Net Value*, *Highest Risk Score*, and *Random Exploration*) to maximize recovered funds while minimizing inspection overhead ($C_{FP}$).

---

## 🌟 Key Application Features

### 1. Executive Overview Dashboard
- High-level KPIs computed live from the active dataset and trained models: best-model PR-AUC (measured, test split), estimated cost savings (depends on cost assumptions), fraud catch rate (measured), explanation stability (measured drift Z-tests).
- Interactive cards highlighting the three core research pillars.
- Live stream status pulse and processed dollar volume counter.

### 2. Dataset Ingestion & Historical Transaction Data
- **CSV Dataset Ingestion**: Upload custom historical transaction CSVs via drag-and-drop or file picker with client-side parsing.
- **Synthetic sample**: a seeded, deterministic 8,000-transaction / 240-day synthetic dataset (labelled "Synthetic sample") is loaded when no file is uploaded.
- **Flexible Column Mapping & Validation**: Auto-detects standard columns (`timestamp`, `amount`, `is_fraud`/`label`, `category`, `velocity`, `distance`, `device_score`, `is_online`, `foreign_country`) and validates positive amounts and binary fraud labels.
- **Strict Chronological Splits**: Automatically partitions transactions chronologically into Contiguous Train (60%), Validation (20%), and Held-out Test (20%) splits to eliminate look-ahead bias.
- **Zero Label Leakage Guarantee**: Model scoring is strictly restricted to behavioral features; ground-truth fraud labels are excluded from model inference inputs at both compile and runtime levels.
- **Zero-PII Compliance**: No credit card numbers (PANs), CVVs, passwords, or personally identifiable customer information are ever ingested or stored.
- **Test-Cohort Stream Replay**: Toggle between replaying the chronologically ordered held-out test split or an infinite synthetic generator in the live stream.

### 3. Live Stream & Real-Time Scoring
- Continuous streaming ingestion or chronological replay of test transactions.
- Explicit visual distinction between **Model Predictions** (risk score, predicted fraud status) and **Confirmed Ground Truth Outcomes** (confirmed fraud, confirmed legitimate, dispute pending).
- **Fraud Spike Frequency Chart**: Recharts line chart computing the rolling 5-transaction fraud rate over the trailing 50 events.
- **Model Polarization Density Plot**: 20-bin probability density area chart with Gaussian kernel smoothing and polarization index metrics.
- **Comparative Error Cost Breakdown**: Recharts comparative bar chart tracking False Positive review costs vs Missed Fraud dollar loss vs Protected capital.
- Interactive transaction table with **Explain** button opening a forensic attribution modal for immediate investigator action.

### 4. Model Benchmark & Cost-Sensitive Tuning
- Comparative evaluation of **Logistic Regression**, **Random Forest**, **XGBoost**, and **LightGBM** dynamically evaluated across the loaded dataset's Train, Validation, and Test cohorts.
- Evaluated on Precision, Recall, PR-AUC, MCC, False Positives, and Estimated Dollar Savings.
- Interactive decision threshold slider ($\tau$) coupled with an SVG cost-optimization curve that finds the empirical cost-minimizing threshold $\tau^* = \arg\min_\tau [ \text{Cost}(\tau) ]$.
- Custom user-defined $C_{FP}$ (investigation friction) and $C_{FN}$ (chargeback penalty) parameter inputs.

### 5. SHAP Explanations & Local Attribution
- **Global Feature Importance**: Mean absolute Shapley value horizontal bar chart across all training features.
- **Local Waterfall Attribution**: Additive decomposition of individual transactions showing feature shifts from base rate to output score with domain forensic descriptions.
- Prominent epistemological disclaimer detailing that SHAP explains model internal reliance, not external physical causality.

### 6. Confidence-Bounded SHAP Drift Monitor
- 12-month longitudinal feature trajectory visualizer with 95% and 99% confidence ribbon intervals.
- Statistical significance table with window-level sample size ($N$), monthly mean SHAP, standard error, $Z$-statistic, and $p$-value.
- Low-volume test case demonstration (Month 4 low-volume noise suppression vs Month 6 concept shift).

### 7. Delayed-Label Evaluation Workbench
- Interactive toggle between 7, 14, 30, and 60-day dispute settlement horizons.
- Recharts label maturation stacked bar chart illustrating how premature evaluation drastically underestimates false negatives until the chargeback window closes.
- Isolation of confirmed fraud, confirmed legitimate, and latent unconfirmed transactions.

### 8. Limited Review Queue Simulator
- Daily analyst review capacity slider (10 to 120 reviews/day).
- Side-by-side performance comparison of 4 alert prioritization policies:
  - **Highest Expected Dollar Loss**: $E[\text{Loss}] = P(\text{fraud}) \times \text{Amount}$
  - **Highest Risk Score**: Pure $P(\text{fraud})$ ordering
  - **Cost-Utility Net Value**: $E[\text{Recovery}] - C_{FP}$
  - **Random Exploration**: Uniform audit baseline
- Recharts capacity curve chart displaying fraud dollars captured across the full capacity spectrum.

### 9. Methodology & Academic Limitations
- Class weighting applied strictly to train splits (no oversampling in this prototype).
- Expected cost formulation: $\text{Total Cost} = \text{FP} \cdot C_{FP} + \text{FN} \cdot C_{FN}$.
- Honest academic limitations: synthetic data limitations, lack of proprietary bank chargeback timestamps, and user-defined operational friction costs.

### 10. About System & Tech Stack
- Technology stack overview (Python ML ecosystem + TypeScript / React 19 / Recharts frontend).
- Expected project demonstration deliverables.
- Citations of foundational literature including 2026 dollar-metric study preprints.

---

## 💻 Tech Stack & Architecture

- **Frontend Core**: React 19, TypeScript, Vite
- **Styling & Theme**: Tailwind CSS v4, dark & light mode support
- **Data Visualization**: Recharts (LineChart, AreaChart, BarChart), SVG math curves
- **Icons**: Lucide React
- **Unit Testing**: Node.js native test runner (`node --test`)
- **Server**: Express + tsx with Vite middleware support

---

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation & Run

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run unit tests**:
   ```bash
   npm test
   # or run directly:
   node --test src/utils/*.test.ts
   ```

3. **Start local development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Build production bundle**:
   ```bash
   npm run build
   ```

---

## 🧪 Unit Testing Suite

The application includes automated unit test suites covering all core mathematical algorithms:
- `src/utils/csvParser.test.ts`: RFC 4180 CSV parsing, header mapping, validation, and 60/20/20 chronological partitioning.
- `src/utils/modelScorer.test.ts`: Anti-leakage inference verification, cohort metric calculation (PR-AUC, Recall, Dollars Saved).
- `src/utils/costSensitivity.test.ts`: Optimal threshold search, cost curve monotonicity, and stream error costs.
- `src/utils/shapDrift.test.ts`: Two-sided $Z$-tests, 95% confidence intervals, and low-volume variance suppression.
- `src/utils/queueSimulation.test.ts`: Alert ranking strategies under capacity limits and workload saturation.
- `src/utils/probabilityDensity.test.ts`: Binned probability density, kernel smoothing, and polarization metrics.

Run tests anytime with:
```bash
node --test src/utils/*.test.ts
```

---

## 📄 License & Attribution

Developed as an academic demonstration and research prototype for Time-Aware, Cost-Sensitive Credit Card Fraud Detection.
For academic inquiries and citations, refer to the literature grounding section within the application.

