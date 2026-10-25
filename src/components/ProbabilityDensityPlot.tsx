import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { Transaction } from '../types/fraud';
import { computeProbabilityDensity } from '../utils/probabilityDensity';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';

interface ProbabilityDensityPlotProps {
  transactions: Transaction[];
  decisionThreshold: number;
}

export const ProbabilityDensityPlot: React.FC<ProbabilityDensityPlotProps> = ({
  transactions,
  decisionThreshold,
}) => {
  const densityResult = useMemo(() => {
    return computeProbabilityDensity(transactions, 20);
  }, [transactions]);

  const { bins, metrics } = densityResult;

  // Chart data formatted for Recharts
  const chartData = useMemo(() => {
    return bins.map((b) => ({
      binRange: b.binRange,
      binCenter: b.binCenter,
      density: b.density,
      densityPct: b.densityPct,
      count: b.count,
      legitimateCount: b.legitimateCount,
      fraudCount: b.fraudCount,
      unknownCount: b.unknownCount,
    }));
  }, [bins]);

  const isHighlyPolarized = metrics.polarizationRatioPct >= 70;

  return (
    <div className="cs-card p-5 space-y-4">
      {/* Header & Polarization Status */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold cs-text flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Model Prediction Probability Density & Polarization Spectrum</span>
            </h3>
            <span
              className={`text-xs px-2.5 py-0.5 rounded font-mono font-semibold ${
                isHighlyPolarized
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30'
              }`}
            >
              {metrics.status}
            </span>
          </div>
          <p className="text-xs cs-muted mt-1">
            Visualizes whether the model cleanly polarizes transactions into low-risk (P ≈ 0.0) and high-risk (P ≈ 1.0) extremes versus hedging in the ambiguous middle.
          </p>
        </div>

        {/* Real-time Polarization KPI Badges */}
        <div className="flex items-center gap-6 text-xs font-mono">
          <div>
            <span className="cs-muted block text-xs">Polarization Ratio (P &lt; 0.2 or P ≥ 0.8):</span>
            <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {metrics.polarizationRatioPct}%
            </span>
          </div>
          <div>
            <span className="cs-muted block text-xs">Ambiguity Grey Zone (0.35 ≤ P &lt; 0.65):</span>
            <span
              className={`text-base font-bold tabular-nums ${
                metrics.ambiguityRatioPct > 20 ? 'text-amber-700 dark:text-amber-400' : 'cs-muted'
              }`}
            >
              {metrics.ambiguityRatioPct}%
            </span>
          </div>
          <div>
            <span className="cs-muted block text-xs">Stream Sample:</span>
            <span className="text-base font-bold cs-text tabular-nums">
              N = {metrics.totalCount}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts Area Density Curve */}
      <div className="h-60 w-full cs-inset p-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -20, bottom: 4 }}>
            <defs>
              <linearGradient id="densityGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="35%" stopColor="#10b981" stopOpacity={0.2} />
                <stop offset="50%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="70%" stopColor="#E5484D" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#E5484D" stopOpacity={0.5} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
            <XAxis
              dataKey="binCenter"
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) => val.toFixed(2)}
            />
            <YAxis
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              tickFormatter={(val) => `${val}%`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="cs-card p-3 shadow-xl text-xs space-y-1 font-sans">
                    <div className="font-semibold cs-text border-b cs-divider pb-1 flex justify-between gap-4">
                      <span>Probability Bin: [{d.binRange}]</span>
                      <span className="font-mono text-emerald-700 dark:text-emerald-400">{d.densityPct}% of cohort</span>
                    </div>
                    <div className="cs-muted flex justify-between gap-4">
                      <span>Total Transactions:</span>
                      <strong className="font-mono cs-text">{d.count}</strong>
                    </div>
                    <div className="cs-muted flex justify-between gap-4">
                      <span>Confirmed Legitimate (Label 0):</span>
                      <span className="font-mono text-emerald-700 dark:text-emerald-400">{d.legitimateCount}</span>
                    </div>
                    <div className="cs-muted flex justify-between gap-4">
                      <span>Confirmed Fraud (Label 1):</span>
                      <span className="font-mono text-red-600 dark:text-red-400 font-semibold">{d.fraudCount}</span>
                    </div>
                    <div className="cs-muted flex justify-between gap-4">
                      <span>Pending / Unknown label:</span>
                      <span className="font-mono">{d.unknownCount}</span>
                    </div>
                    <div className="pt-1 text-xs cs-muted">
                      {d.binCenter >= decisionThreshold ? (
                        <span className="text-red-600 dark:text-red-400 font-medium">Exceeds Deployment Threshold (τ = {decisionThreshold.toFixed(2)})</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400 font-medium">Auto-Cleared Straight-Through</span>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            {/* Active Decision Threshold Indicator */}
            <ReferenceLine
              x={decisionThreshold}
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 4"
              label={{
                value: `Active Threshold τ = ${decisionThreshold.toFixed(2)}`,
                fill: '#38bdf8',
                fontSize: 12,
                position: 'insideTopLeft',
                className: 'cs-svg-blue',
              }}
            />
            <Area
              type="monotone"
              dataKey="density"
              stroke="#38bdf8"
              strokeWidth={2}
              fill="url(#densityGradient)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Risk Zone Spectrum Legend & Diagnostic Guidance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold block">0.00 – 0.35 · Clearance Mode</span>
          <p className="cs-muted text-xs mt-1 leading-relaxed">
            High-density peak on the left confirms the model exhibits strong confidence clearing routine, low-risk cardholder transactions.
          </p>
        </div>

        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
          <span className="text-amber-700 dark:text-amber-400 font-semibold block">0.35 – 0.65 · Ambiguity Grey Zone</span>
          <p className="cs-muted text-xs mt-1 leading-relaxed">
            Low density valley in the middle is ideal. A rising mound here signals feature degradation or concept drift requiring threshold review.
          </p>
        </div>

        <div className="p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg">
          <span className="text-red-600 dark:text-red-400 font-semibold block">0.65 – 1.00 · Fraud Action Mode</span>
          <p className="cs-muted text-xs mt-1 leading-relaxed">
            Concentrated right-side density indicates the model separates high-risk transactions sharply from routine ones.
          </p>
        </div>
      </div>
    </div>
  );
};
