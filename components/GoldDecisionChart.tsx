import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { BarChart3, SlidersHorizontal, Trash2 } from 'lucide-react';
import { GoldCandle, GoldRealtimeData, MarketSnapshot } from '../types';

interface GoldDecisionChartProps {
  marketData?: GoldRealtimeData;
  snapshots: MarketSnapshot[];
  gmOutput?: string;
  onClearSnapshots: () => void;
}

interface IndicatorSettings {
  timeframe: string;
  showMA: boolean;
  maFast: number;
  maSlow: number;
  showBollinger: boolean;
  bollPeriod: number;
  bollMultiplier: number;
  showDecisionLevels: boolean;
  showSnapshotMarks: boolean;
}

const SETTINGS_KEY = 'alphacouncil_gold_chart_settings_v1';

const DEFAULT_SETTINGS: IndicatorSettings = {
  timeframe: '15min',
  showMA: true,
  maFast: 20,
  maSlow: 60,
  showBollinger: true,
  bollPeriod: 20,
  bollMultiplier: 2,
  showDecisionLevels: true,
  showSnapshotMarks: true
};

function loadSettings(): IndicatorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: IndicatorSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

function movingAverage(values: number[], index: number, period: number) {
  if (period <= 1 || index + 1 < period) return undefined;
  const slice = values.slice(index + 1 - period, index + 1);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function standardDeviation(values: number[]) {
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function normalizeSeries(candles: GoldCandle[]) {
  return [...candles].reverse();
}

function extractDecisionLevels(text = '') {
  const levels: Array<{ label: string; value: number; color: string }> = [];
  const patterns = [
    { label: '止损', color: '#ef4444', regex: /(止损|硬止损)[^\d]{0,12}(\d{4,5}(?:\.\d+)?)/g },
    { label: '入场', color: '#3b82f6', regex: /(入场|买入|离场区间)[^\d]{0,12}(\d{4,5}(?:\.\d+)?)/g },
    { label: '止盈', color: '#22c55e', regex: /(止盈|目标|减仓)[^\d]{0,12}(\d{4,5}(?:\.\d+)?)/g },
    { label: '支撑', color: '#14b8a6', regex: /(支撑)[^\d]{0,12}(\d{4,5}(?:\.\d+)?)/g },
    { label: '压力', color: '#f59e0b', regex: /(压力|阻力)[^\d]{0,12}(\d{4,5}(?:\.\d+)?)/g }
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = Number(match[2]);
      if (Number.isFinite(value) && !levels.some(level => Math.abs(level.value - value) < 0.01 && level.label === pattern.label)) {
        levels.push({ label: pattern.label, value, color: pattern.color });
      }
    }
  }

  return levels.slice(0, 10);
}

function decisionColor(decision?: string) {
  if (decision === '买入') return '#22c55e';
  if (decision === '卖出') return '#ef4444';
  if (decision === '观望') return '#f59e0b';
  return '#94a3b8';
}

const GoldDecisionChart: React.FC<GoldDecisionChartProps> = ({ marketData, snapshots, gmOutput, onClearSnapshots }) => {
  const [settings, setSettings] = useState<IndicatorSettings>(loadSettings);

  const updateSettings = (patch: Partial<IndicatorSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const availableTimeframes = useMemo(() => {
    const keys = Object.keys(marketData?.candleSeries || {});
    return keys.length ? keys : ['15min'];
  }, [marketData]);

  const chartData = useMemo(() => {
    const candles = normalizeSeries(marketData?.candleSeries?.[settings.timeframe] || marketData?.candles || []);
    const closes = candles.map(candle => candle.close);

    return candles.map((candle, index) => {
      const maFast = movingAverage(closes, index, settings.maFast);
      const maSlow = movingAverage(closes, index, settings.maSlow);
      const bollSlice = closes.slice(index + 1 - settings.bollPeriod, index + 1);
      const bollMid = bollSlice.length === settings.bollPeriod ? movingAverage(closes, index, settings.bollPeriod) : undefined;
      const sd = bollMid ? standardDeviation(bollSlice) : undefined;

      return {
        time: candle.datetime,
        label: candle.datetime.slice(5, 16),
        close: candle.close,
        high: candle.high,
        low: candle.low,
        maFast,
        maSlow,
        bollUpper: bollMid && sd ? bollMid + sd * settings.bollMultiplier : undefined,
        bollLower: bollMid && sd ? bollMid - sd * settings.bollMultiplier : undefined
      };
    });
  }, [marketData, settings]);

  const decisionLevels = useMemo(() => extractDecisionLevels(gmOutput), [gmOutput]);

  const snapshotMarks = useMemo(() => {
    if (!chartData.length || !snapshots.length) return [];
    const first = new Date(chartData[0].time).getTime();
    const last = new Date(chartData[chartData.length - 1].time).getTime();
    return snapshots
      .filter(snapshot => snapshot.marketData?.price && snapshot.marketData.timestamp >= first - 12 * 60 * 60 * 1000 && snapshot.marketData.timestamp <= last + 12 * 60 * 60 * 1000)
      .slice(0, 40)
      .map(snapshot => {
        const nearest = chartData.reduce((best, point) => {
          const diff = Math.abs(new Date(point.time).getTime() - snapshot.marketData.timestamp);
          return diff < best.diff ? { point, diff } : best;
        }, { point: chartData[0], diff: Number.POSITIVE_INFINITY });
        return {
          x: nearest.point.time,
          y: snapshot.marketData.price,
          decision: snapshot.gmDecision
        };
      });
  }, [chartData, snapshots]);

  return (
    <section className="border border-slate-800 bg-slate-900/40 rounded-lg overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-amber-300" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100">黄金行情与AI决策图</h3>
            <p className="text-[11px] text-slate-500">15分钟默认分析，行情快照服务端留存，指标参数可调</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={settings.timeframe}
            onChange={(event) => updateSettings({ timeframe: event.target.value })}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
          >
            {availableTimeframes.map(timeframe => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
          </select>
          <button onClick={onClearSnapshots} className="flex items-center gap-1 border border-slate-700 rounded px-2 py-1 text-slate-400 hover:text-red-300">
            <Trash2 className="w-3 h-3" />
            清空快照
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-0">
        <div className="h-[420px] p-3">
          {chartData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: 64, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="#1e293b" vertical={false} />
                <XAxis dataKey="time" tickFormatter={(value) => String(value).slice(5, 16)} tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={24} />
                <YAxis domain={['dataMin - 8', 'dataMax + 8']} orientation="right" tick={{ fill: '#94a3b8', fontSize: 11 }} width={64} />
                <Tooltip
                  contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0' }}
                  formatter={(value: number, name: string) => [Number(value).toFixed(2), name]}
                />
                <Line type="monotone" dataKey="close" name="收盘" stroke="#eab308" dot={false} strokeWidth={2} />
                {settings.showMA && <Line type="monotone" dataKey="maFast" name={`MA${settings.maFast}`} stroke="#3b82f6" dot={false} strokeWidth={1.5} />}
                {settings.showMA && <Line type="monotone" dataKey="maSlow" name={`MA${settings.maSlow}`} stroke="#ef4444" dot={false} strokeWidth={1.5} />}
                {settings.showBollinger && <Line type="monotone" dataKey="bollUpper" name="BOLL上轨" stroke="#64748b" dot={false} strokeDasharray="4 4" />}
                {settings.showBollinger && <Line type="monotone" dataKey="bollLower" name="BOLL下轨" stroke="#64748b" dot={false} strokeDasharray="4 4" />}
                {settings.showDecisionLevels && decisionLevels.map(level => (
                  <ReferenceLine key={`${level.label}-${level.value}`} y={level.value} stroke={level.color} strokeDasharray="6 4" label={{ value: `${level.label} ${level.value}`, fill: level.color, fontSize: 11, position: 'right' }} />
                ))}
                {settings.showSnapshotMarks && snapshotMarks.map((mark, index) => (
                  <ReferenceDot key={`${mark.x}-${index}`} x={mark.x} y={mark.y} r={4} fill={decisionColor(mark.decision)} stroke="#020617" />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-slate-500">完成一次分析后显示多周期行情图</div>
          )}
        </div>

        <div className="border-t xl:border-t-0 xl:border-l border-slate-800 p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <SlidersHorizontal className="w-4 h-4" />
            指标设置
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings.showMA} onChange={(event) => updateSettings({ showMA: event.target.checked })} />
            均线
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="2" max="200" value={settings.maFast} onChange={(event) => updateSettings({ maFast: Number(event.target.value) || 20 })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
            <input type="number" min="2" max="300" value={settings.maSlow} onChange={(event) => updateSettings({ maSlow: Number(event.target.value) || 60 })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings.showBollinger} onChange={(event) => updateSettings({ showBollinger: event.target.checked })} />
            布林带
          </label>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="5" max="200" value={settings.bollPeriod} onChange={(event) => updateSettings({ bollPeriod: Number(event.target.value) || 20 })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
            <input type="number" min="1" max="4" step="0.1" value={settings.bollMultiplier} onChange={(event) => updateSettings({ bollMultiplier: Number(event.target.value) || 2 })} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100" />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings.showDecisionLevels} onChange={(event) => updateSettings({ showDecisionLevels: event.target.checked })} />
            显示AI关键价位
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={settings.showSnapshotMarks} onChange={(event) => updateSettings({ showSnapshotMarks: event.target.checked })} />
            显示历史分析标记
          </label>
          <div className="text-[11px] text-slate-500 leading-5 border-t border-slate-800 pt-3">
            快照数: {snapshots.length}<br />
            当前源: {marketData?.source || 'N/A'}<br />
            现价: {marketData?.price ? `$${marketData.price.toFixed(2)}` : 'N/A'}
          </div>
        </div>
      </div>
    </section>
  );
};

export default GoldDecisionChart;
