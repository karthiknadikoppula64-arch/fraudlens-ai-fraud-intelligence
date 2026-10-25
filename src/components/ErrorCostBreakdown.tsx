import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Transaction } from '../types/fraud';
import { computeStreamErrorCosts } from '../utils/costSensitivity';
import { ProvenanceBadge } from './ui';
import {
  Scale,
  DollarSign,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  TrendingDown,
  Info,
} from 'lucide-react';

interface ErrorCostBreakdownProps {
  transactions: Transaction[];
  decisionThreshold: number;
  setDecisionThreshold?: (t: number) => void;
  costFP: number;
  setCostFP: (c: number) => void;
  costFNPenalty: number;
  setCostFNPenalty: (p: number) => void;
}

export const ErrorCostBreakdown: React.FC<ErrorCostBreakdownProps> = ({
  transactions,
  decisionThreshold,
  setDecisionThreshold,
  costFP,
  setCostFP,
  costFNPenalty,
  setCostFNPenalty,
}) => {
  // Compute cost breakdown using pure utility
  const costData = useMemo(() => {
    return computeStreamErrorCosts(transactions, decisionThreshold, costFP, costFNPenalty);
  }, [transactions, decisionThreshold, costFP, costFNPenalty]);

  // Comparative data for Recharts BarChart
  const barChartData = useMemo(() => {
    return [
      {
        category: 'Cost of False Positives (C_FP)',
        cost: costData.costFalsePositives,
        count: costData.fpCount,
        fill: '#f59e0b', // amber
        description: `${costData.fpCount} false alerts × $${costFP} investigation cost`,
      },
      {
        category: 'Cost of Missed Fraud (C_FN)',
        cost: costData.totalCostMissedFraud,
        count: costData.fnCount,
        fill: '#E5484D', // rose
        description: `$${costData.costMissedFraudAmounts.toLocaleString()} stolen amounts + $${costData.costMissedFraudPenalties} penalties`,
      },
      {
        category: 'Fraud Value Protected (TP)',
        cost: costData.dollarsProtected,
        count: costData.tpCount,
        fill: '#10b981', // emerald
        description: `${costData.tpCount} attacks blocked at authorization`,
      },
    ];
  }, [costData, costFP]);

  const totalErrorCost = costData.costFalsePositives + costData.totalCostMissedFraud;
  const fpPctOfErrors = totalErrorCost > 0 ? Math.round((costData.costFalsePositives / totalErrorCost) * 100) : 0;
  const fnPctOfErrors = totalErrorCost > 0 ? 100 - fpPctOfErrors : 0;

  return (
    <div className="cs-card p-5 space-y-6">
      {/* Component Title & Executive Overview */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold cs-text flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Comparative Error Cost Breakdown: False Positives vs. Missed Fraud</span>
            </h3>
            <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
              Stream buffer (N = {transactions.length}{costData.unlabelledCount > 0 ? `, ${costData.unlabelledCount} unlabelled excluded` : ''})
            </span>
            <ProvenanceBadge kind="estimated" />
          </div>
          <p className="text-xs cs-muted mt-1">
            Quantifies the operational trade-off between customer friction / analyst investigation costs (C_FP) and direct chargeback losses (C_FN).
          </p>
        </div>

        {/* Cost Ratio Badge */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-right">
            <span className="cs-muted block text-xs">Total Financial Overhead:</span>
            <span className="text-base font-bold text-red-600 dark:text-red-400 tabular-nums">
              ${costData.totalOperationalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-right pl-4 border-l cs-divider">
            <span className="cs-muted block text-xs">Net Value Saved:</span>
            {/* Sign shown honestly: a negative net value previously rendered as "+$-123.00" in green. */}
            <span className={`text-base font-bold tabular-nums ${costData.netFinancialSavings >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {costData.netFinancialSavings >= 0 ? '+' : '−'}${Math.abs(costData.netFinancialSavings).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cs-inset p-4">
          <div className="flex items-center justify-between text-xs cs-muted mb-1">
            <span>False Positive Cost (C_FP)</span>
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-400 tabular-nums">
            ${costData.costFalsePositives.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs cs-subtle mt-1">
            {costData.fpCount} false alarms × ${costFP} review friction
          </div>
        </div>

        <div className="cs-inset p-4">
          <div className="flex items-center justify-between text-xs cs-muted mb-1">
            <span>Missed Fraud Loss (C_FN)</span>
            <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400 tabular-nums">
            ${costData.totalCostMissedFraud.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs cs-subtle mt-1">
            {costData.fnCount} missed frauds (${costData.costMissedFraudAmounts.toFixed(0)} + ${costData.costMissedFraudPenalties} fees)
          </div>
        </div>

        <div className="cs-inset p-4">
          <div className="flex items-center justify-between text-xs cs-muted mb-1">
            <span>Fraud Dollars Protected</span>
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
            ${costData.dollarsProtected.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs cs-subtle mt-1">
            {costData.tpCount} fraudulent attacks intercepted
          </div>
        </div>

        <div className="cs-inset p-4">
          <div className="flex items-center justify-between text-xs cs-muted mb-1">
            <span>Error Cost Distribution</span>
            <DollarSign className="w-4 h-4 text-blue-700 dark:text-blue-400" />
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono cs-text tabular-nums">
              {fpPctOfErrors}% : {fnPctOfErrors}%
            </span>
          </div>
          <div className="text-xs cs-subtle mt-1">
            FP Review Costs vs. Missed Fraud Losses
          </div>
        </div>
      </div>

      {/* Main Recharts Bar Visualizer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recharts Bar Chart Container */}
        <div className="lg:col-span-2 cs-inset p-4 space-y-2">
          <div className="flex items-center justify-between text-xs cs-muted mb-2">
            <span className="font-medium cs-muted">Financial Impact by Error Category ($ USD)</span>
            <span className="font-mono cs-subtle">Labelled rows only</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barChartData}
                margin={{ top: 16, right: 24, left: 0, bottom: 20 }}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} horizontal={false} />
                <XAxis
                  type="number"
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  tickFormatter={(val) => `$${val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}`}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  width={180}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="cs-card p-3 shadow-xl text-xs space-y-1">
                        <div className="font-semibold cs-text border-b cs-divider pb-1">
                          {d.category}
                        </div>
                        <div className="cs-muted flex justify-between gap-4">
                          <span>Dollar Amount:</span>
                          <strong className="font-mono cs-text">${d.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                        </div>
                        <div className="cs-muted flex justify-between gap-4">
                          <span>Transaction Count:</span>
                          <span className="font-mono cs-muted">{d.count} transactions</span>
                        </div>
                        <p className="text-xs cs-muted pt-1 leading-relaxed">
                          {d.description}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {barChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* User Cost Parameters & Tradeoff Inspector */}
        <div className="cs-inset p-4 flex flex-col justify-between space-y-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider cs-muted flex items-center gap-1.5 mb-3">
              <Sliders className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              <span>User-Defined Cost Controls</span>
            </h4>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="cs-muted">False Positive Review Cost (C_FP):</span>
                  <span className="font-mono font-bold text-amber-700 dark:text-amber-400 tabular-nums">${costFP}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={costFP}
                  aria-label="False positive review cost in dollars"
                  onChange={(e) => setCostFP(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                />
                <span className="text-xs cs-subtle block mt-0.5">
                  Analyst labor + customer SMS friction per alert.
                </span>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="cs-muted">Fixed Missed Fraud Penalty:</span>
                  <span className="font-mono font-bold text-red-600 dark:text-red-400 tabular-nums">${costFNPenalty}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  step="5"
                  value={costFNPenalty}
                  aria-label="Fixed missed fraud penalty in dollars"
                  onChange={(e) => setCostFNPenalty(Number(e.target.value))}
                  className="w-full accent-rose-500 cursor-pointer"
                />
                <span className="text-xs cs-subtle block mt-0.5">
                  Chargeback arbitration + compliance fee per missed breach.
                </span>
              </div>

              {setDecisionThreshold && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="cs-muted">Decision Threshold (τ):</span>
                    <span className="font-mono font-bold text-blue-700 dark:text-blue-400 tabular-nums">{decisionThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="0.90"
                    step="0.05"
                    value={decisionThreshold}
                    onChange={(e) => setDecisionThreshold(Number(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                  <span className="text-xs cs-subtle block mt-0.5">
                    Lowering τ reduces missed fraud but increases review costs.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Operational Policy Guidance Callout */}
          <div className="cs-inset p-3 text-xs cs-muted space-y-1">
            <div className="flex items-center gap-1.5 cs-muted font-semibold">
              <Info className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" />
              <span>Policy Balance Insight</span>
            </div>
            {costData.costFalsePositives > costData.totalCostMissedFraud ? (
              <p>
                <strong>Over-Filtering Warning:</strong> Currently spending more on investigating false alarms (${costData.costFalsePositives.toFixed(0)}) than lost from missed frauds. Consider raising the threshold τ to lower operational review overhead.
              </p>
            ) : costData.totalCostMissedFraud > costData.costFalsePositives ? (
              <p>
                <strong>Under-Protection Warning:</strong> Missed fraud losses (${costData.totalCostMissedFraud.toFixed(0)}) exceed review costs. Lowering the threshold τ will intercept higher-value attacks before settlement.
              </p>
            ) : (
              <p>
                <strong>Equilibrium:</strong> False positive review expenditure matches chargeback losses under current user cost assumptions.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
