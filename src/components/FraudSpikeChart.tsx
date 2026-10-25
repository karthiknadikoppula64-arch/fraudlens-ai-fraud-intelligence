import React, { useMemo } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { TrendingUp } from 'lucide-react';
import type { Transaction } from '../types/fraud';
import { ProvenanceBadge } from './ui';

interface FraudSpikeChartProps {
  transactions: Transaction[];
  decisionThreshold: number;
}

interface Point {
  index: number;
  id: string;
  amount: number;
  isAlert: boolean;
  label: Transaction['groundTruthLabel'];
  rollingAlertPct: number;
  probabilityPct: number;
}

const WINDOW = 5;
const SPIKE_PCT = 40;

/** Rolling share of model alerts over the last 50 stream events (oldest → newest). */
export const FraudSpikeChart: React.FC<FraudSpikeChartProps> = ({ transactions, decisionThreshold }) => {
  const data = useMemo<Point[]>(() => {
    const slice = transactions.slice(0, 50).reverse();
    return slice.map((t, i, arr) => {
      const sub = arr.slice(Math.max(0, i - WINDOW + 1), i + 1);
      const alerts = sub.filter((x) => x.predictedProbability >= decisionThreshold).length;
      return {
        index: i + 1,
        id: t.id,
        amount: t.amount,
        isAlert: t.predictedProbability >= decisionThreshold,
        label: t.groundTruthLabel,
        rollingAlertPct: Math.round((alerts / sub.length) * 100),
        probabilityPct: Math.round(t.predictedProbability * 100),
      };
    });
  }, [transactions, decisionThreshold]);

  const current = data.length ? data[data.length - 1].rollingAlertPct : 0;
  const peak = data.length ? Math.max(...data.map((d) => d.rollingAlertPct)) : 0;
  const alerts = data.filter((d) => d.isAlert).length;
  const confirmed = data.filter((d) => d.label === 1).length;
  const spike = current >= SPIKE_PCT;

  return (
    <div className="cs-card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold cs-text flex flex-wrap items-center gap-2">
            <TrendingUp className="w-4 h-4 text-red-500" aria-hidden="true" />
            Alert frequency & spike monitor (last 50 events)
            <span className={`text-xs px-2 py-0.5 rounded font-mono font-semibold border ${spike ? 'bg-red-50 text-red-700 border-red-200 dark:bg-[#E5484D]/15 dark:text-red-300 dark:border-[#E5484D]/30' : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30'}`}>
              {spike ? 'Spike detected' : 'Normal frequency'}
            </span>
            <ProvenanceBadge kind="predicted" />
          </h3>
          <p className="text-xs cs-muted mt-0.5">Trailing {WINDOW}-event rolling share of transactions flagged by the model. Red dots mark rows with a confirmed fraud label.</p>
        </div>
        <dl className="flex items-center gap-6 text-xs font-mono">
          <div><dt className="cs-subtle text-xs">Current</dt><dd className={`text-base font-bold tabular-nums ${spike ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{current}%</dd></div>
          <div><dt className="cs-subtle text-xs">Peak</dt><dd className="text-base font-bold tabular-nums text-amber-700 dark:text-amber-400">{peak}%</dd></div>
          <div><dt className="cs-subtle text-xs">Flagged</dt><dd className="text-base font-bold tabular-nums cs-text">{alerts}/{data.length}</dd></div>
          <div><dt className="cs-subtle text-xs">Confirmed fraud</dt><dd className="text-base font-bold tabular-nums cs-text">{confirmed}</dd></div>
        </dl>
      </div>
      <div className="h-56 w-full cs-inset p-3" role="img" aria-label={`Rolling alert rate chart; current ${current} percent, peak ${peak} percent`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, left: -20, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94A3B8" strokeOpacity={0.25} />
            <XAxis dataKey="index" stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => `#${v}`} />
            <YAxis domain={[0, 100]} stroke="#8494AB" fontSize={12} tickLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as Point;
                return (
                  <div className="bg-[#0B1220] border border-[#173B70] p-2.5 rounded-lg text-xs text-slate-100 space-y-0.5">
                    <div className="font-mono font-bold">{d.id}</div>
                    <div>Rolling alert rate: <strong>{d.rollingAlertPct}%</strong></div>
                    <div>Predicted probability: {d.probabilityPct}%</div>
                    <div>Amount: ${d.amount.toFixed(2)}</div>
                    <div>Outcome: {d.label === null ? 'Pending / Unknown' : d.label === 1 ? 'Confirmed fraud' : 'Confirmed legitimate'}</div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={SPIKE_PCT} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: `Spike threshold (${SPIKE_PCT}%)`, fill: '#F59E0B', fontSize: 12, position: 'insideTopRight', className: 'cs-svg-amber' }} />
            <Line
              type="monotone"
              dataKey="rollingAlertPct"
              stroke="#3988FF"
              strokeWidth={2.5}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: Point }) => {
                const { cx, cy, payload } = props;
                if (!payload || cx === undefined || cy === undefined) return <g key={`d-${Math.random()}`} />;
                const fill = payload.label === 1 ? '#E5484D' : payload.isAlert ? '#F59E0B' : '#10B981';
                return <circle key={`d-${payload.id}-${payload.index}`} cx={cx} cy={cy} r={payload.label === 1 ? 4.5 : 2.5} fill={fill} stroke="#0B1220" strokeWidth={1} />;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs cs-muted">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#3988FF] inline-block" /> Rolling alert rate</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Predicted suspicious</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#E5484D] inline-block" /> Confirmed fraud</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Predicted legitimate</span>
      </div>
    </div>
  );
};
